import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

import { build } from "esbuild";
import type { Plugin } from "esbuild";

import {
  defaultConfig,
  LeflectConfig,
  LeflectConfigInput,
  LeflectEntryDefinition,
  LeflectEntryVariant,
  LeflectPlugin
} from "@leflect-java/schema";

const DEFAULT_CONFIG_FILE_NAMES = [
  "leflect.config.ts",
  "leflect.config.mjs",
  "leflect.config.js",
  "leflect.config.cjs",
  "leflect.config.json"
] as const;

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

export async function resolveDefaultConfigPath(root: string): Promise<string | undefined> {
  for (const candidate of DEFAULT_CONFIG_FILE_NAMES) {
    const candidatePath = path.join(root, candidate);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const root = path.resolve(options.root ?? process.cwd());
  const requestedConfigPath = options.configPath ? path.resolve(options.configPath) : undefined;
  const configPath = requestedConfigPath ?? await resolveDefaultConfigPath(root);

  let fileConfig: LeflectConfigInput = {};
  let loaded = false;

  if (configPath && await fileExists(configPath)) {
    fileConfig = await readConfigFile(configPath);
    loaded = true;
  }

  const merged: LeflectConfig = {
    root,
    ...defaultConfig,
    ...fileConfig,
    ...options.overrides,
    classpathDiscovery: {
      ...(defaultConfig.classpathDiscovery ?? {}),
      ...(fileConfig.classpathDiscovery ?? {}),
      ...(options.overrides?.classpathDiscovery ?? {})
    },
    java: {
      ...(defaultConfig.java ?? {}),
      ...(fileConfig.java ?? {}),
      ...(options.overrides?.java ?? {})
    },
    jsp: {
      ...(defaultConfig.jsp ?? {}),
      ...(fileConfig.jsp ?? {}),
      ...(options.overrides?.jsp ?? {})
    },
    entryFiles: {
      ...(fileConfig.entryFiles ?? {}),
      ...(options.overrides?.entryFiles ?? {})
    },
    entries: options.overrides?.entries ?? fileConfig.entries,
    plugins: options.overrides?.plugins ?? fileConfig.plugins
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
  const classpathDiscovery = config.classpathDiscovery;
  const resolvedClasspathDiscovery =
    classpathDiscovery &&
    (classpathDiscovery.enabled !== undefined || classpathDiscovery.searchRoots?.length)
      ? {
          ...classpathDiscovery,
          searchRoots: classpathDiscovery.searchRoots?.map((entry) => resolvePath(root, entry))
        }
      : classpathDiscovery;
  const javaConfig = config.java;
  const resolvedJava =
    javaConfig &&
    (
      javaConfig.workerJar ||
      javaConfig.jreHome ||
      javaConfig.javaHome ||
      javaConfig.classpath?.length ||
      javaConfig.mavenCommand
    )
      ? {
          ...javaConfig,
          workerJar: javaConfig.workerJar ? resolvePath(root, javaConfig.workerJar) : undefined,
          jreHome: javaConfig.jreHome ? resolvePath(root, javaConfig.jreHome) : undefined,
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
      jspConfig.semanticAstOut ||
      jspConfig.classpath?.length ||
      jspConfig.mavenCommand ||
      jspConfig.astMode ||
      jspConfig.tld?.paths?.length ||
      jspConfig.tld?.autoLoad !== undefined ||
      jspConfig.tld?.uriMap ||
      jspConfig.taglibResolvers
    )
      ? {
          ...jspConfig,
          webappRoot: jspConfig.webappRoot ? resolvePath(root, jspConfig.webappRoot) : undefined,
          generatedJavaOut: jspConfig.generatedJavaOut
            ? resolvePath(root, jspConfig.generatedJavaOut)
            : undefined,
          astOut: jspConfig.astOut ? resolvePath(root, jspConfig.astOut) : undefined,
          semanticAstOut: jspConfig.semanticAstOut
            ? resolvePath(root, jspConfig.semanticAstOut)
            : undefined,
          classpath: jspConfig.classpath?.map((entry) => resolvePath(root, entry)),
          mavenCommand: jspConfig.mavenCommand
            ? resolveCommand(root, jspConfig.mavenCommand)
            : undefined,
          tld: jspConfig.tld
            ? {
                ...jspConfig.tld,
                paths: jspConfig.tld.paths?.map((entry) => resolvePath(root, entry)),
                uriMap: jspConfig.tld.uriMap
                  ? Object.fromEntries(
                      Object.entries(jspConfig.tld.uriMap).map(([uri, target]) => [
                        uri,
                        resolveResourcePath(root, target)
                      ])
                    )
                  : undefined
              }
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
    classpathDiscovery: resolvedClasspathDiscovery,
    entries: config.entries?.map((entry) => resolveEntry(entry, root)),
    plugins: config.plugins,
    java: resolvedJava,
    jsp: resolvedJsp
  };
}

function resolveEntry(entry: LeflectEntryDefinition, root: string): LeflectEntryDefinition {
  return {
    ...entry,
    jsp: entry.jsp?.map((target) => normalizeSourcePath(root, target)),
    java: entry.java?.map((target) => normalizeSourcePath(root, target)),
    query: entry.query?.map((target) => target.trim()).filter(Boolean),
    interfaceSpecs: entry.interfaceSpecs?.map((target) => target.trim()).filter(Boolean),
    tags: entry.tags?.map((target) => target.trim()).filter(Boolean),
    variants: entry.variants?.map((variant) => resolveEntryVariant(variant, root))
  };
}

function resolveEntryVariant(variant: LeflectEntryVariant, root: string): LeflectEntryVariant {
  return {
    ...variant,
    jsp: variant.jsp?.map((target) => normalizeSourcePath(root, target)),
    java: variant.java?.map((target) => normalizeSourcePath(root, target)),
    query: variant.query?.map((target) => target.trim()).filter(Boolean),
    interfaceSpecs: variant.interfaceSpecs?.map((target) => target.trim()).filter(Boolean),
    tags: variant.tags?.map((target) => target.trim()).filter(Boolean)
  };
}

function normalizeSourcePath(root: string, target: string): string {
  const absoluteTarget = path.isAbsolute(target) ? target : path.resolve(root, target);
  const relativeTarget = path.relative(root, absoluteTarget);

  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`Entry target must stay inside the project root: ${target}`);
  }

  return toPosix(relativeTarget);
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

function resolveResourcePath(root: string, target: string): string {
  const separator = target.indexOf("!/");
  if (separator < 0) {
    return resolvePath(root, target);
  }

  const archivePath = target.slice(0, separator);
  const entryPath = target.slice(separator + 2);
  return `${resolvePath(root, archivePath)}!/${entryPath}`;
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
  if (config.classpathDiscovery) {
    if (typeof config.classpathDiscovery !== "object") {
      throw new Error("Config 'classpathDiscovery' must be an object");
    }
    if (
      config.classpathDiscovery.enabled !== undefined &&
      typeof config.classpathDiscovery.enabled !== "boolean"
    ) {
      throw new Error("Config 'classpathDiscovery.enabled' must be a boolean");
    }
    if (
      config.classpathDiscovery.maxRetries !== undefined &&
      (!Number.isInteger(config.classpathDiscovery.maxRetries) ||
        config.classpathDiscovery.maxRetries < 0)
    ) {
      throw new Error("Config 'classpathDiscovery.maxRetries' must be a non-negative integer");
    }
    if (config.classpathDiscovery.searchRoots) {
      if (!Array.isArray(config.classpathDiscovery.searchRoots)) {
        throw new Error("Config 'classpathDiscovery.searchRoots' must be an array of strings");
      }
      if (!config.classpathDiscovery.searchRoots.every((entry) => typeof entry === "string")) {
        throw new Error("Config 'classpathDiscovery.searchRoots' must be an array of strings");
      }
    }
  }
  if (config.entryFiles) {
    if (typeof config.entryFiles !== "object") {
      throw new Error("Config 'entryFiles' must be an object");
    }
    if (config.entryFiles.java) {
      if (!Array.isArray(config.entryFiles.java)) {
        throw new Error("Config 'entryFiles.java' must be an array of strings");
      }
      if (!config.entryFiles.java.every((entry) => typeof entry === "string")) {
        throw new Error("Config 'entryFiles.java' must be an array of strings");
      }
    }
    if (config.entryFiles.jsp) {
      if (!Array.isArray(config.entryFiles.jsp)) {
        throw new Error("Config 'entryFiles.jsp' must be an array of strings");
      }
      if (!config.entryFiles.jsp.every((entry) => typeof entry === "string")) {
        throw new Error("Config 'entryFiles.jsp' must be an array of strings");
      }
    }
  }
  if (config.entries) {
    if (!Array.isArray(config.entries)) {
      throw new Error("Config 'entries' must be an array");
    }
    for (const entry of config.entries) {
      validateEntryDefinition(entry, "entries");
    }
  }
  if (config.plugins) {
    if (!Array.isArray(config.plugins)) {
      throw new Error("Config 'plugins' must be an array");
    }
    for (const plugin of config.plugins) {
      validatePlugin(plugin);
    }
  }
  if (config.java) {
    if (typeof config.java !== "object") {
      throw new Error("Config 'java' must be an object");
    }
    if (config.java.workerJar && typeof config.java.workerJar !== "string") {
      throw new Error("Config 'java.workerJar' must be a string");
    }
    if (config.java.jreHome && typeof config.java.jreHome !== "string") {
      throw new Error("Config 'java.jreHome' must be a string");
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
    if (config.jsp.semanticAstOut && typeof config.jsp.semanticAstOut !== "string") {
      throw new Error("Config 'jsp.semanticAstOut' must be a string");
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
    if (config.jsp.tld) {
      if (typeof config.jsp.tld !== "object") {
        throw new Error("Config 'jsp.tld' must be an object");
      }
      if (
        config.jsp.tld.autoLoad !== undefined &&
        typeof config.jsp.tld.autoLoad !== "boolean"
      ) {
        throw new Error("Config 'jsp.tld.autoLoad' must be a boolean");
      }
      if (config.jsp.tld.paths) {
        if (!Array.isArray(config.jsp.tld.paths)) {
          throw new Error("Config 'jsp.tld.paths' must be an array of strings");
        }
        if (!config.jsp.tld.paths.every((entry) => typeof entry === "string")) {
          throw new Error("Config 'jsp.tld.paths' must be an array of strings");
        }
      }
      if (config.jsp.tld.uriMap) {
        if (typeof config.jsp.tld.uriMap !== "object" || Array.isArray(config.jsp.tld.uriMap)) {
          throw new Error("Config 'jsp.tld.uriMap' must be an object");
        }
        for (const [key, value] of Object.entries(config.jsp.tld.uriMap)) {
          if (!key || typeof value !== "string") {
            throw new Error("Config 'jsp.tld.uriMap' must map string URIs to string paths");
          }
        }
      }
    }
    if (config.jsp.taglibResolvers) {
      if (
        typeof config.jsp.taglibResolvers !== "object" ||
        Array.isArray(config.jsp.taglibResolvers)
      ) {
        throw new Error("Config 'jsp.taglibResolvers' must be an object");
      }
      for (const [key, value] of Object.entries(config.jsp.taglibResolvers)) {
        if (!key || typeof value !== "function") {
          throw new Error("Config 'jsp.taglibResolvers' must map resolver keys to functions");
        }
      }
    }
  }
}

function validateEntryDefinition(entry: LeflectEntryDefinition, scope: string): void {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Config '${scope}' entries must be objects`);
  }
  if (!entry.id || typeof entry.id !== "string") {
    throw new Error(`Config '${scope}.id' must be a string`);
  }
  if (entry.type !== "virtual_page" && entry.type !== "entry") {
    throw new Error(`Config '${scope}.type' must be 'virtual_page' or 'entry'`);
  }
  validateOptionalStringArray(entry.jsp, `${scope}.jsp`);
  validateOptionalStringArray(entry.java, `${scope}.java`);
  validateOptionalStringArray(entry.query, `${scope}.query`);
  validateOptionalStringArray(entry.interfaceSpecs, `${scope}.interfaceSpecs`);
  validateOptionalStringArray(entry.tags, `${scope}.tags`);
  if (entry.variants) {
    if (!Array.isArray(entry.variants)) {
      throw new Error(`Config '${scope}.variants' must be an array`);
    }
    for (const variant of entry.variants) {
      if (!variant || typeof variant !== "object") {
        throw new Error(`Config '${scope}.variants' entries must be objects`);
      }
      if (!variant.id || typeof variant.id !== "string") {
        throw new Error(`Config '${scope}.variants.id' must be a string`);
      }
      validateOptionalStringArray(variant.jsp, `${scope}.variants.jsp`);
      validateOptionalStringArray(variant.java, `${scope}.variants.java`);
      validateOptionalStringArray(variant.query, `${scope}.variants.query`);
      validateOptionalStringArray(variant.interfaceSpecs, `${scope}.variants.interfaceSpecs`);
      validateOptionalStringArray(variant.tags, `${scope}.variants.tags`);
    }
  }
}

function validatePlugin(plugin: LeflectPlugin): void {
  if (!plugin || typeof plugin !== "object") {
    throw new Error("Config 'plugins' entries must be objects");
  }
  if (!plugin.name || typeof plugin.name !== "string") {
    throw new Error("Config 'plugins.name' must be a string");
  }
  if (
    plugin.enforce !== undefined &&
    plugin.enforce !== "pre" &&
    plugin.enforce !== "normal" &&
    plugin.enforce !== "post"
  ) {
    throw new Error("Config 'plugins.enforce' must be 'pre', 'normal', or 'post'");
  }
  if (plugin.hooks) {
    if (!Array.isArray(plugin.hooks)) {
      throw new Error("Config 'plugins.hooks' must be an array");
    }
    for (const hook of plugin.hooks) {
      if (!hook || typeof hook !== "object") {
        throw new Error("Config 'plugins.hooks' entries must be objects");
      }
      if (!hook.id || typeof hook.id !== "string") {
        throw new Error("Config 'plugins.hooks.id' must be a string");
      }
      if (hook.target !== "java" && hook.target !== "jsp" && hook.target !== "common") {
        throw new Error("Config 'plugins.hooks.target' must be 'java', 'jsp', or 'common'");
      }
      if (typeof hook.when !== "function") {
        throw new Error("Config 'plugins.hooks.when' must be a function");
      }
      if (typeof hook.resolve !== "function") {
        throw new Error("Config 'plugins.hooks.resolve' must be a function");
      }
    }
  }
}

function validateOptionalStringArray(value: string[] | undefined, fieldName: string): void {
  if (!value) {
    return;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Config '${fieldName}' must be an array of strings`);
  }
}

async function readConfigFile(configPath: string): Promise<LeflectConfigInput> {
  if (configPath.endsWith(".json")) {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as LeflectConfigInput;
  }

  return loadConfigModule(configPath);
}

async function loadConfigModule(configPath: string): Promise<LeflectConfigInput> {
  const tempDir = await fs.mkdtemp(path.join(path.dirname(configPath), ".leflect-config-"));
  const outfile = path.join(tempDir, "config.cjs");

  try {
    const result = await build({
      absWorkingDir: path.dirname(configPath),
      entryPoints: [configPath],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      target: ["node20"],
      outfile,
      sourcemap: "inline",
      plugins: [createLeflectPackageAliasPlugin()]
    });

    const output = result.outputFiles[0];
    if (!output) {
      throw new Error(`Failed to build config module: ${configPath}`);
    }

    await fs.writeFile(outfile, output.text, "utf8");
    delete require.cache[outfile];
    const loaded = require(outfile) as { default?: LeflectConfigInput } | LeflectConfigInput;
    const config = normalizeModuleExport(loaded);

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`Config module must export an object: ${configPath}`);
    }

    return config;
  } finally {
    delete require.cache[outfile];
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function normalizeModuleExport(
  loaded: { default?: LeflectConfigInput } | LeflectConfigInput
): LeflectConfigInput {
  if (
    loaded &&
    typeof loaded === "object" &&
    "default" in loaded &&
    loaded.default &&
    typeof loaded.default === "object"
  ) {
    return loaded.default;
  }

  return loaded as LeflectConfigInput;
}

function createLeflectPackageAliasPlugin(): Plugin {
  const aliases = new Map([
    ["@leflect-java/core", resolveLeflectPackageEntry("core")],
    ["@leflect-java/schema", resolveLeflectPackageEntry("schema")]
  ].filter((entry): entry is [string, string] => Boolean(entry[1])));

  return {
    name: "leflect-package-alias",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@leflect-java\/(core|schema)$/ }, (args) => {
        const resolved = aliases.get(args.path);
        if (!resolved) {
          return undefined;
        }

        return {
          path: resolved
        };
      });
    }
  };
}

function resolveLeflectPackageEntry(packageName: "core" | "schema"): string | undefined {
  const sourceCandidates = packageName === "core"
    ? [
        path.resolve(__dirname, "config-entry.ts"),
        path.resolve(__dirname, "..", "src", "config-entry.ts"),
        path.resolve(__dirname, "index.ts"),
        path.resolve(__dirname, "..", "src", "index.ts")
      ]
    : [
        path.resolve(__dirname, "..", "..", packageName, "src", "index.ts")
      ];
  const distCandidates = packageName === "core"
    ? [
        path.resolve(__dirname, "config-entry.js"),
        path.resolve(__dirname, "..", "dist", "config-entry.js"),
        path.resolve(__dirname, "index.js"),
        path.resolve(__dirname, "..", "dist", "index.js"),
        path.resolve(__dirname, "..", "..", packageName, "dist", "index.js")
      ]
    : [
        path.resolve(__dirname, "..", "..", packageName, "dist", "index.js")
      ];

  const candidates = [...sourceCandidates, ...distCandidates];
  return candidates.find((candidate) => existsSync(candidate));
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
