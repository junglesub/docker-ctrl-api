import { Elysia } from "elysia";
import { KeyConfigService } from "./KeyConfig";
import { validateKey } from "../tools/validateKeys";

// Read Headers and query to get data
export const AuthService = new Elysia({ name: "Service.Auth" })
  .use(KeyConfigService)
  .resolve(
    { as: "scoped" },
    ({ query: { id }, headers: { "x-api-key": apiKey }, KeyYaml }) => ({
      Auth: validateKey(KeyYaml, id, apiKey || ""),
    })
  )
  .macro(({ onBeforeHandle }) => ({
    isCorrectCred(value: boolean) {
      onBeforeHandle(({ Auth, error }) => {
        if (!Auth) return error(401);
      });
    },
  }));
