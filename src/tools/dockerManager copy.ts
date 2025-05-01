import Docker from "dockerode";
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

interface UpdateOptions {
  containerName: string;
  imagePullTag?: string; // default: "latest"
  waitTimeMs?: number; // wait after start before checking health
  maxRetries?: number; // health check retries before rollback
}

export async function updateContainerWithRollback(options: UpdateOptions) {
  const {
    containerName,
    imagePullTag = "latest",
    waitTimeMs = 5000,
    maxRetries = 5,
  } = options;

  try {
    // 1. Find the running container
    const containers = await docker.listContainers({ all: true });
    const existing = containers.find((c) =>
      c.Names.includes(`/${containerName}`)
    );
    if (!existing) throw new Error(`Container "${containerName}" not found.`);

    const container = docker.getContainer(existing.Id);
    const oldImageRef = existing.Image;

    // 2. Get image ID (SHA)
    const oldImageInspect = await docker.getImage(oldImageRef).inspect();
    const oldImageId = oldImageInspect.Id;
    console.log(`Current image ID (SHA): ${oldImageId}`);

    // 3. Pull latest image
    const baseImageName = oldImageRef.split("@")[0].split(":")[0];
    const pullRef = `${baseImageName}:${imagePullTag}`;
    console.log(`Pulling latest image: ${pullRef}`);
    await new Promise<void>((resolve, reject) => {
      docker
        .pull(pullRef)
        .then((stream) => {
          docker.modem.followProgress(stream, onFinished);
          function onFinished(err: any) {
            if (err) reject(err);
            else resolve();
          }
        })
        .catch((err) => reject(err));
    });

    // 4. Stop and remove old container
    console.log("Stopping and removing current container...");
    await container.stop();
    await container.remove();

    // 5. Create and start new container
    console.log("Creating new container...");
    const newContainer = await docker.createContainer({
      ...existing, // simplified: assumes volumes/envs/ports carried over
      Image: pullRef,
      name: containerName,
    });
    await newContainer.start();

    // 6. Wait and check health status
    console.log("Checking health...");
    let success = false;
    for (let i = 0; i < maxRetries; i++) {
      await wait(waitTimeMs);
      const status = await getContainerHealthStatus(newContainer);
      console.log(`Health check attempt ${i + 1}: ${status}`);
      if (status === "healthy") {
        success = true;
        break;
      } else if (status === "unhealthy") {
        break; // no point continuing
      }
    }

    if (success) {
      console.log("✅ New container is healthy.");
    } else {
      console.warn("❌ New container is unhealthy. Rolling back...");

      // Stop and remove failed container
      await newContainer.stop();
      await newContainer.remove();

      // Re-create old container with SHA
      const rollback = await docker.createContainer({
        ...existing,
        Image: oldImageId,
        name: containerName,
      });
      await rollback.start();
      console.log("✅ Rolled back to previous version.");
    }
  } catch (err) {
    console.error("Update failed:", err);
  }
}

async function getContainerHealthStatus(
  container: Docker.Container
): Promise<string | null> {
  const inspect = await container.inspect();
  return inspect?.State?.Health?.Status || null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
