import { Elysia, t } from "elysia";
import { AuthService } from "./services/Auth";
import { updateContainerWithRollback } from "./tools/dockerManager";

const app = new Elysia()
  .onError(({ error, code }) => {
    if (code === "NOT_FOUND") return;

    console.error(error);
  })
  .use(AuthService)
  .post(
    "/update",
    ({ Auth, body }) => {
      updateContainerWithRollback({
        containerName: Auth!.container_name,
        githubInfo: {
          commitSha: body.gh.commitSha,
          githubRepo: body.gh.githubRepo,
          githubToken: body.gh.githubToken,
        },
      });
      return "ok";
    },
    {
      body: t.Object({
        gh: t.Object({
          commitSha: t.String(),
          githubRepo: t.String(),
          githubToken: t.String(),
        }),
      }),
      query: t.Object({
        id: t.String(),
      }),
      headers: t.Object({
        "x-api-key": t.String(),
      }),
      isCorrectCred: true,
    }
  )
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
