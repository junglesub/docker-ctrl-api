import { Elysia } from "elysia";
import { getKeyConfig } from "./KeyConfig";
import { validateKey } from "../tools/validateKeys";

// Read Headers and query to get data
export const AuthService = new Elysia({ name: "Service.Auth" })
  .resolve(
    { as: "scoped" },
    ({ query: { id }, headers: { "x-api-key": apiKey } }) => ({
      Auth: validateKey(getKeyConfig(), id, apiKey || ""),
    })
  )
  .macro(({ onBeforeHandle }) => ({
    isCorrectCred(value: boolean) {
      onBeforeHandle(({ Auth, error }) => {
        if (!Auth) return error(401);
      });
    },
  }));
