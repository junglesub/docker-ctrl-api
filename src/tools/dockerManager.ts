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
    await docker.pull(pullRef);

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
