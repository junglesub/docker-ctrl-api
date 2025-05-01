import { Elysia } from "elysia";
import fs from "fs";
import yaml from "js-yaml";
import { KeyConfig } from "../interface";

// Read Key Config and save to variable
export const KeyConfigService = new Elysia({
  name: "Service.KeyConfig",
}).derive({ as: "global" }, () => ({
  KeyYaml: loadKeyConfig(),
}));

const loadKeyConfig = (): KeyConfig => {
  const file = fs.readFileSync(process.env.CONFIG_PATH || "config.yml", "utf8");
  return yaml.load(file) as KeyConfig;
};
