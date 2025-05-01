import { Elysia } from "elysia";
import fs from "fs";
import yaml from "js-yaml";
import { KeyConfig } from "../interface";

// TODO: Make this as a service

export const getKeyConfig = (): KeyConfig => {
  console.log("Loading Key Config");
  const file = fs.readFileSync(process.env.CONFIG_PATH || "config.yml", "utf8");
  return yaml.load(file) as KeyConfig;
};
