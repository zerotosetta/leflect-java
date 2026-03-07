import fs from "fs/promises";
import path from "path";

import { defaultConfig, LeflectConfig, LeflectConfigInput } from "@lefectjava/schema";

export type LoadConfigOptions = {
  root?: string;
  configPath?: string;
  overrides?: Partial<LeflectConfig>;
};

export type LoadedConfig = {
  config: LeflectConfig;
  configPath?: string;
  loaded: boolean;
};

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const root = path.resolve(options.root ?? process.cwd());
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(root, "leflect.config.json");

  let fileConfig: LeflectConfigInput = {};
  let loaded = false;

  if (await fileExists(configPath)) {
    const raw = await fs.readFile(configPath, "utf8");
    fileConfig = JSON.parse(raw) as LeflectConfigInput;
    loaded = true;
  }

  const merged: LeflectConfig = {
    root,
    ...defaultConfig,
    ...fileConfig,
    ...options.overrides
  } as LeflectConfig;

  const resolved = resolveConfigPaths(merged, root);
  validateConfig(resolved);

  return {
    config: resolved,
    configPath: loaded ? configPath : undefined,
    loaded
  };
}

function resolveConfigPaths(config: LeflectConfig, root: string): LeflectConfig {
  return {
    ...config,
    root,
    analysisOut: resolvePath(root, config.analysisOut),
    ignoreFile: config.ignoreFile ? resolvePath(root, config.ignoreFile) : undefined,
    labelsOut: config.labelsOut ? resolvePath(root, config.labelsOut) : undefined
  };
}

function resolvePath(root: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(root, target);
}

function validateConfig(config: LeflectConfig): void {
  if (!config.root || typeof config.root !== "string") {
    throw new Error("Config 'root' must be a string");
  }
  if (!config.analysisOut || typeof config.analysisOut !== "string") {
    throw new Error("Config 'analysisOut' must be a string");
  }
  if (config.ignoreFile && typeof config.ignoreFile !== "string") {
    throw new Error("Config 'ignoreFile' must be a string");
  }
  if (config.labelsOut && typeof config.labelsOut !== "string") {
    throw new Error("Config 'labelsOut' must be a string");
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
