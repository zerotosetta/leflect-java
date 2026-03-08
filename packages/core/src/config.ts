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
    ...options.overrides,
    java: {
      ...(defaultConfig.java ?? {}),
      ...(fileConfig.java ?? {}),
      ...(options.overrides?.java ?? {})
    },
    jsp: {
      ...(defaultConfig.jsp ?? {}),
      ...(fileConfig.jsp ?? {}),
      ...(options.overrides?.jsp ?? {})
    }
  };

  const resolved = resolveConfigPaths(merged, root);
  validateConfig(resolved);

  return {
    config: resolved,
    configPath: loaded ? configPath : undefined,
    loaded
  };
}

function resolveConfigPaths(config: LeflectConfig, root: string): LeflectConfig {
  const resolvedAnalysisOut = resolvePath(root, config.analysisOut);
  const javaConfig = config.java;
  const resolvedJava =
    javaConfig &&
    (
      javaConfig.workerJar ||
      javaConfig.javaHome ||
      javaConfig.classpath?.length ||
      javaConfig.mavenCommand
    )
      ? {
          ...javaConfig,
          workerJar: javaConfig.workerJar ? resolvePath(root, javaConfig.workerJar) : undefined,
          javaHome: javaConfig.javaHome ? resolvePath(root, javaConfig.javaHome) : undefined,
          classpath: javaConfig.classpath?.map((entry) => resolvePath(root, entry)),
          mavenCommand: javaConfig.mavenCommand
            ? resolveCommand(root, javaConfig.mavenCommand)
            : undefined
        }
      : javaConfig;
  const jspConfig = config.jsp;
  const resolvedJsp =
    jspConfig &&
    (
      jspConfig.webappRoot ||
      jspConfig.generatedJavaOut ||
      jspConfig.astOut ||
      jspConfig.classpath?.length ||
      jspConfig.mavenCommand
    )
      ? {
          ...jspConfig,
          webappRoot: jspConfig.webappRoot ? resolvePath(root, jspConfig.webappRoot) : undefined,
          generatedJavaOut: jspConfig.generatedJavaOut
            ? resolvePath(root, jspConfig.generatedJavaOut)
            : undefined,
          astOut: jspConfig.astOut ? resolvePath(root, jspConfig.astOut) : undefined,
          classpath: jspConfig.classpath?.map((entry) => resolvePath(root, entry)),
          mavenCommand: jspConfig.mavenCommand
            ? resolveCommand(root, jspConfig.mavenCommand)
            : undefined
        }
      : jspConfig;

  return {
    ...config,
    root,
    analysisOut: resolvedAnalysisOut,
    ignoreFile: config.ignoreFile ? resolvePath(root, config.ignoreFile) : undefined,
    labelsOut: config.labelsOut
      ? resolvePath(root, config.labelsOut)
      : path.join(resolvedAnalysisOut, "index", "labels.json"),
    java: resolvedJava,
    jsp: resolvedJsp
  };
}

function resolvePath(root: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(root, target);
}

function resolveCommand(root: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  if (target.startsWith(".") || target.includes("/") || target.includes("\\")) {
    return path.resolve(root, target);
  }
  return target;
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
  if (config.java) {
    if (typeof config.java !== "object") {
      throw new Error("Config 'java' must be an object");
    }
    if (config.java.workerJar && typeof config.java.workerJar !== "string") {
      throw new Error("Config 'java.workerJar' must be a string");
    }
    if (config.java.javaHome && typeof config.java.javaHome !== "string") {
      throw new Error("Config 'java.javaHome' must be a string");
    }
    if (config.java.classpath) {
      if (!Array.isArray(config.java.classpath)) {
        throw new Error("Config 'java.classpath' must be an array of strings");
      }
      if (!config.java.classpath.every((entry) => typeof entry === "string")) {
        throw new Error("Config 'java.classpath' must be an array of strings");
      }
    }
    if (config.java.mavenCommand && typeof config.java.mavenCommand !== "string") {
      throw new Error("Config 'java.mavenCommand' must be a string");
    }
  }
  if (config.jsp) {
    if (typeof config.jsp !== "object") {
      throw new Error("Config 'jsp' must be an object");
    }
    if (
      config.jsp.astMode &&
      config.jsp.astMode !== "lightweight" &&
      config.jsp.astMode !== "jasper"
    ) {
      throw new Error("Config 'jsp.astMode' must be 'lightweight' or 'jasper'");
    }
    if (config.jsp.webappRoot && typeof config.jsp.webappRoot !== "string") {
      throw new Error("Config 'jsp.webappRoot' must be a string");
    }
    if (config.jsp.generatedJavaOut && typeof config.jsp.generatedJavaOut !== "string") {
      throw new Error("Config 'jsp.generatedJavaOut' must be a string");
    }
    if (config.jsp.astOut && typeof config.jsp.astOut !== "string") {
      throw new Error("Config 'jsp.astOut' must be a string");
    }
    if (config.jsp.classpath) {
      if (!Array.isArray(config.jsp.classpath)) {
        throw new Error("Config 'jsp.classpath' must be an array of strings");
      }
      if (!config.jsp.classpath.every((entry) => typeof entry === "string")) {
        throw new Error("Config 'jsp.classpath' must be an array of strings");
      }
    }
    if (config.jsp.mavenCommand && typeof config.jsp.mavenCommand !== "string") {
      throw new Error("Config 'jsp.mavenCommand' must be a string");
    }
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
