import Docker from "dockerode";
import { GithubInfo } from "../interface";
import { updateGitHubCommitStatuses } from "./githubStatuses";
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

interface UpdateOptions {
  containerName: string;
  imagePullTag?: string;
  maxWaitMs?: number; // default 180000 (3 minute)
  pollIntervalMs?: number; // default 5000
  githubInfo?: GithubInfo;
}

export async function updateContainerWithRollback(options: UpdateOptions) {
  const {
    containerName,
    imagePullTag = "latest",
    maxWaitMs = 180_000, // wait upto 3 minutes
    pollIntervalMs = 5000,
    githubInfo,
  } = options;

  try {
    // Notify GitHub status
    if (githubInfo)
      updateGitHubCommitStatuses({
        state: "pending",
        description: "Updating container...",
        githubInfo,
      });

    // 1. Get running container
    const containers = await docker.listContainers({ all: true });
    const existing = containers.find((c) =>
      c.Names.includes(`/${containerName}`)
    );
    if (!existing) throw new Error(`Container "${containerName}" not found.`);

    const container = docker.getContainer(existing.Id);
    const oldImageRef = existing.Image;
    const oldImageInspect = await docker.getImage(oldImageRef).inspect();
    const oldImageId = oldImageInspect.Id;
    const oldContainerInfo = await container.inspect();

    // 2. Pull new image
    const baseImageName =
      oldContainerInfo.Config.Image.split("@")[0].split(":")[0];
    const pullRef = `${baseImageName}:${imagePullTag}`;
    console.log(`Pulling image: ${pullRef}`);

    let pullAttempts = 0;
    const maxPullAttempts = 10;
    let currentDelay = 10_000; // Initial delay 10 second

    while (pullAttempts < maxPullAttempts) {
      try {
        console.log(
          `Attempt ${
            pullAttempts + 1
          }/${maxPullAttempts} to pull image ${pullRef}.`
        );
        await new Promise<void>((resolve, reject) => {
          docker.pull(pullRef, {}, (err: any, stream: any) => {
            if (err) {
              // 초기 pull 요청 자체의 오류 (예: docker 데몬 연결 불가)
              return reject(err);
            }
            docker.modem.followProgress(
              stream,
              (progressErr: any, output: any) => {
                if (progressErr) {
                  // 스트림 진행 중 오류
                  return reject(progressErr);
                }
                // output 배열의 마지막 요소가 실제 pull 결과를 담고 있을 가능성이 높음
                const lastMessage =
                  output && output.length > 0
                    ? output[output.length - 1]
                    : null;
                if (
                  lastMessage &&
                  lastMessage.errorDetail &&
                  lastMessage.error
                ) {
                  // Docker Hub 등에서 manifest not found 와 같은 오류를 errorDetail.message 또는 error 필드로 전달
                  return reject(
                    new Error(
                      lastMessage.errorDetail.message || lastMessage.error
                    )
                  );
                }
                if (
                  lastMessage &&
                  lastMessage.status &&
                  lastMessage.status
                    .toLowerCase()
                    .includes("image is up to date")
                ) {
                  // 이미지가 최신인 경우, 성공으로 간주하고 ID 검사를 진행
                  resolve();
                  return;
                }
                if (output && output.some((o: any) => o.error)) {
                  // 스트림 중간에 에러가 있었는지 확인
                  const errorEntry = output.find((o: any) => o.error);
                  return reject(
                    new Error(
                      errorEntry.errorDetail?.message || errorEntry.error
                    )
                  );
                }
                // 성공적으로 pull 완료 (스트림 종료)
                resolve();
              }
            );
          });
        });

        const newPulledImageInspect = await docker.getImage(pullRef).inspect();
        // 'latest' 태그이고, pull된 이미지 ID가 이전 이미지 ID와 동일한 경우 CDN 전파 지연 가능성
        if (
          imagePullTag === "latest" &&
          newPulledImageInspect.Id === oldImageId
        ) {
          if (pullAttempts < maxPullAttempts - 1) {
            // 마지막 시도가 아닐 경우에만 에러 발생
            throw new Error(
              `Image ${pullRef} is up to date, but its ID (${newPulledImageInspect.Id}) matches the old image ID. Potential CDN propagation delay.`
            );
          } else {
            // 마지막 시도에서는 경고만 하고 진행 (후속 헬스체크에 의존)
            console.warn(
              `Image ${pullRef} is up to date and its ID matches the old image ID on the last attempt (${
                pullAttempts + 1
              }/${maxPullAttempts}). Proceeding with caution, relying on subsequent health checks.`
            );
          }
        }

        console.log(`Image ${pullRef} pulled successfully.`);
        break; // Pull successful, exit loop
      } catch (err: any) {
        pullAttempts++;
        const errorMessage = err.message || err.toString();
        console.warn(
          `Attempt ${pullAttempts}/${maxPullAttempts}: Failed to pull image ${pullRef}. Error: ${errorMessage}`
        );

        const normalizedErrorMessage = errorMessage.toLowerCase();
        // 재시도 조건: (특정 태그 && (404 유사 오류)) || (latest 태그 && ID 동일로 인한 CDN 지연 의심) || 일반 네트워크/풀 오류
        const isRetryableError =
          (imagePullTag !== "latest" &&
            (normalizedErrorMessage.includes("not found") ||
              normalizedErrorMessage.includes("manifest unknown") ||
              (normalizedErrorMessage.includes("manifest for") &&
                normalizedErrorMessage.includes("not found")))) ||
          (imagePullTag === "latest" &&
            normalizedErrorMessage.includes(
              "potential cdn propagation delay"
            )) ||
          normalizedErrorMessage.includes("timeout") || // 일반적인 타임아웃
          normalizedErrorMessage.includes("error pulling image") || // dockerode의 일반적인 pull 에러 메시지
          normalizedErrorMessage.includes("tls handshake timeout") || // 네트워크 관련
          normalizedErrorMessage.includes("pull access denied"); // 접근 권한 문제 (일시적일 수 있음)

        if (isRetryableError && pullAttempts < maxPullAttempts) {
          console.log(`Retrying in ${currentDelay / 1000} seconds...`);
          await wait(currentDelay);
          currentDelay = Math.floor(currentDelay * 1.5); // Exponential backoff with int floor
        } else {
          // 최종 실패
          const finalErrorMessage = `Failed to pull image ${pullRef} after ${maxPullAttempts} attempts. Last error: ${errorMessage}`;
          console.error(finalErrorMessage);
          // 에러를 다시 던져서 updateContainerWithRollback의 catch 블록에서 처리하도록 함
          throw new Error(finalErrorMessage);
        }
      }
    }

    // 3. Stop & remove old container
    console.log("Stopping current container...");
    await container.stop();
    await container.remove();

    // 4. Start new container with new image
    console.log("Starting new container...");
    const newContainer = await docker.createContainer({
      ...oldContainerInfo.Config, // 상세 설정 정보
      HostConfig: oldContainerInfo.HostConfig, // 호스트 관련 설정 (포트, 볼륨 등)
      NetworkingConfig: {
        EndpointsConfig: oldContainerInfo.NetworkSettings.Networks,
      }, // 네트워크 설정
      Image: pullRef,
      name: containerName,
    });
    await newContainer.start();

    // 5. Wait for HEALTHY
    console.log("Waiting for container to become healthy...");
    const status = await waitForHealthStatus(
      newContainer,
      maxWaitMs,
      pollIntervalMs
    );

    if (status === "healthy") {
      console.log("✅ New container is healthy.");

      // 6. Delete old image
      if ((await newContainer.inspect()).Image !== oldImageId) {
        console.log("Removing old image:", oldImageId);
        await docker.getImage(oldImageId).remove();
        console.log("✅ Old image removed.");
      }

      if (githubInfo)
        updateGitHubCommitStatuses({
          state: "success",
          description: "Deployment succeeded.",
          githubInfo,
        });
    } else {
      console.warn(
        `❌ Health check failed (status: ${status}). Rolling back...`
      );
      await newContainer.stop();
      await newContainer.remove();

      const rollback = await docker.createContainer({
        ...existing,
        Image: oldImageId,
        name: containerName,
      });
      await rollback.start();
      console.log("✅ Rollback complete.");
      if (githubInfo)
        updateGitHubCommitStatuses({
          state: "failure",
          description: "Deployment failed. Rolled back to previous version.",
          githubInfo,
        });
    }
  } catch (err: any) {
    console.error("Update failed:", err);
    if (githubInfo)
      updateGitHubCommitStatuses({
        state: "error",
        description: "Update failed. " + err.toString().slice(0, 100),
        githubInfo,
      });
  }
}

async function waitForHealthStatus(
  container: Docker.Container,
  maxWaitMs: number,
  pollMs: number
): Promise<"healthy" | "unhealthy" | "timeout" | "none"> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const inspect = await container.inspect();
    const status = inspect?.State?.Health?.Status;

    if (status === "healthy") return "healthy";
    if (status === "unhealthy") return "unhealthy";

    await wait(pollMs);
  }

  return "timeout";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
