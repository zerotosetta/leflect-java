import fs from "fs/promises";
import path from "path";
import readline from "node:readline/promises";

import { JspAstMode, LeflectConfigInput } from "@leflect-java/schema";

import { resolveJavaWorkerJar } from "./worker-jar";

export type ConfigFileFormat = "json" | "ts";

export type InitDefaults = {
  analysisOut: string;
  ignoreFile?: string;
  labelsOut: string;
  autoSystemClasspathEnabled: boolean;
  workerJarAvailable: boolean;
  jspAstMode: JspAstMode;
  webappRoot?: string;
  javaMavenCommand?: string;
  jspMavenCommand?: string;
};

export type InitAnswers = {
  analysisOut: string;
  ignoreFile?: string;
  labelsOut: string;
  autoSystemClasspath: boolean;
  systemClasspathRoots: string[];
  systemClasspathMaxRetries?: number;
  useWorker: boolean;
  workerJar?: string;
  jreHome?: string;
  javaHome?: string;
  javaClasspath: string[];
  javaMavenCommand?: string;
  jspAstMode: JspAstMode;
  webappRoot?: string;
  jspClasspath: string[];
  jspMavenCommand?: string;
  entryJava: string[];
  entryJsp: string[];
};

export type InitCommandOptions = {
  root: string;
  configPath: string;
  configFormat: ConfigFileFormat;
  force: boolean;
  yes: boolean;
  parsed: Record<string, string>;
};

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const defaults = await discoverInitDefaults(options.root);
  const configExists = await fileExists(options.configPath);

  if (configExists && !options.force) {
    if (options.yes) {
      throw new Error(
        `Config already exists at ${options.configPath}. Re-run with '--force' to overwrite it.`
      );
    }

    const overwrite = await withPrompts(async (prompts) =>
      prompts.confirm(`Overwrite existing config at ${options.configPath}?`, false)
    );
    if (!overwrite) {
      console.log("Init aborted. Existing config was left unchanged.");
      return;
    }
  }

  const answers = options.yes
    ? answersFromDefaults(defaults, options.parsed)
    : await collectInteractiveAnswers(defaults, options.parsed, options.root, options.configPath);
  const config = createConfigFromAnswers(options.root, answers);

  await fs.mkdir(path.dirname(options.configPath), { recursive: true });
  await fs.writeFile(
    options.configPath,
    renderConfigFile(config, options.configFormat),
    "utf8"
  );

  console.log(`Config written: ${options.configPath}`);
  console.log(`JSP AST mode: ${answers.jspAstMode}`);
  console.log(`Java worker: ${answers.useWorker ? "enabled" : "disabled"}`);
  console.log("Next step: leflect analyze");
}

export async function discoverInitDefaults(root: string): Promise<InitDefaults> {
  const workerJar = await resolveJavaWorkerJar();
  const workerJarAvailable = Boolean(workerJar);
  const webappRoot = await detectWebappRoot(root);
  const mavenCommand = await detectMavenCommand(root);

  return {
    analysisOut: "./analysis",
    ignoreFile: (await fileExists(path.join(root, ".gitignore"))) ? ".gitignore" : undefined,
    labelsOut: "./analysis/index/labels.json",
    autoSystemClasspathEnabled: false,
    workerJarAvailable,
    jspAstMode: workerJarAvailable ? "jasper" : "lightweight",
    webappRoot,
    javaMavenCommand: mavenCommand,
    jspMavenCommand: mavenCommand
  };
}

export function answersFromDefaults(
  defaults: InitDefaults,
  parsed: Record<string, string>
): InitAnswers {
  const workerJar = parsed["worker-jar"] ?? undefined;
  const useWorker = parsed["use-worker"]
    ? toBoolean(parsed["use-worker"])
    : Boolean(workerJar || defaults.workerJarAvailable);
  const requestedJspAstMode = normalizeJspAstMode(parsed["jsp-ast-mode"]);
  const jspAstMode = useWorker ? requestedJspAstMode ?? defaults.jspAstMode : "lightweight";

  return {
    analysisOut: parsed["out"] ?? defaults.analysisOut,
    ignoreFile: parsed["ignore-file"] ?? defaults.ignoreFile,
    labelsOut: parsed["labels-out"] ?? defaults.labelsOut,
    autoSystemClasspath: parsed["auto-system-classpath"]
      ? toBoolean(parsed["auto-system-classpath"])
      : defaults.autoSystemClasspathEnabled,
    systemClasspathRoots: splitListOption(parsed["system-classpath-roots"]),
    systemClasspathMaxRetries: parseIntegerOption(parsed["system-classpath-max-retries"]),
    useWorker,
    workerJar,
    jreHome: parsed["jre-home"] ?? undefined,
    javaHome: parsed["java-home"] ?? undefined,
    javaClasspath: splitListOption(parsed["java-classpath"]),
    javaMavenCommand: parsed["java-maven-command"] ?? defaults.javaMavenCommand,
    jspAstMode,
    webappRoot: parsed["jsp-webapp-root"] ?? defaults.webappRoot,
    jspClasspath: splitListOption(parsed["jsp-classpath"]),
    jspMavenCommand: parsed["jsp-maven-command"] ?? defaults.jspMavenCommand,
    entryJava: splitPatternOption(parsed["entry-java"]),
    entryJsp: splitPatternOption(parsed["entry-jsp"])
  };
}

export function createConfigFromAnswers(root: string, answers: InitAnswers): LeflectConfigInput {
  const config: LeflectConfigInput = {
    analysisOut: normalizePathValue(root, answers.analysisOut),
    labelsOut: normalizePathValue(root, answers.labelsOut),
    jsp: {
      astMode: answers.jspAstMode
    }
  };

  if (answers.ignoreFile) {
    config.ignoreFile = normalizePathValue(root, answers.ignoreFile);
  }

  if (
    answers.autoSystemClasspath ||
    answers.systemClasspathRoots.length > 0 ||
    answers.systemClasspathMaxRetries !== undefined
  ) {
    config.classpathDiscovery = {
      enabled: answers.autoSystemClasspath
    };
    if (answers.systemClasspathRoots.length > 0) {
      config.classpathDiscovery.searchRoots = answers.systemClasspathRoots.map((entry) =>
        normalizePathValue(root, entry)
      );
    }
    if (answers.systemClasspathMaxRetries !== undefined) {
      config.classpathDiscovery.maxRetries = answers.systemClasspathMaxRetries;
    }
  }

  if (answers.entryJava.length > 0 || answers.entryJsp.length > 0) {
    config.entryFiles = {};
    if (answers.entryJava.length > 0) {
      config.entryFiles.java = answers.entryJava;
    }
    if (answers.entryJsp.length > 0) {
      config.entryFiles.jsp = answers.entryJsp;
    }
  }

  if (answers.useWorker || answers.jreHome || answers.javaHome || answers.javaClasspath.length > 0) {
    config.java = {};
    if (answers.workerJar) {
      config.java.workerJar = normalizePathValue(root, answers.workerJar);
    }
    if (answers.jreHome) {
      config.java.jreHome = normalizePathValue(root, answers.jreHome);
    }
    if (answers.javaHome) {
      config.java.javaHome = normalizePathValue(root, answers.javaHome);
    }
    if (answers.javaClasspath.length > 0) {
      config.java.classpath = answers.javaClasspath.map((entry) => normalizePathValue(root, entry));
    }
    if (answers.javaMavenCommand) {
      config.java.mavenCommand = normalizeCommandValue(root, answers.javaMavenCommand);
    }
  }

  if (answers.webappRoot || answers.jspAstMode === "jasper" || answers.jspClasspath.length > 0) {
    config.jsp = {
      ...(config.jsp ?? {}),
      astMode: answers.jspAstMode,
      generatedJavaOut: "./analysis/generated-jsp-java",
      astOut: "./analysis/jsp-ast"
    };
    if (answers.webappRoot) {
      config.jsp.webappRoot = normalizePathValue(root, answers.webappRoot);
    }
    if (answers.jspClasspath.length > 0) {
      config.jsp.classpath = answers.jspClasspath.map((entry) => normalizePathValue(root, entry));
    }
    if (answers.jspMavenCommand) {
      config.jsp.mavenCommand = normalizeCommandValue(root, answers.jspMavenCommand);
    }
  }

  return config;
}

export function renderConfigFile(
  config: LeflectConfigInput,
  format: ConfigFileFormat
): string {
  if (format === "ts") {
    return [
      "import { defineConfig } from \"@leflect-java/core\";",
      "",
      `export default defineConfig(${JSON.stringify(config, null, 2)});`,
      ""
    ].join("\n");
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

async function collectInteractiveAnswers(
  defaults: InitDefaults,
  parsed: Record<string, string>,
  root: string,
  configPath: string
): Promise<InitAnswers> {
  return withPrompts(async (prompts) => {
    console.log(`Initializing LeflectJava config for ${root}`);
    console.log(`Config target: ${configPath}`);

    const analysisOut = await prompts.text("Analysis output directory", parsed["out"] ?? defaults.analysisOut);
    const ignoreFile = await prompts.optionalText(
      "Ignore rules file (.gitignore syntax)",
      parsed["ignore-file"] ?? defaults.ignoreFile
    );
    const labelsOut = await prompts.text(
      "Labels output path",
      parsed["labels-out"] ?? deriveLabelsPath(analysisOut)
    );
    const autoSystemClasspath = await prompts.confirm(
      "Enable automatic system classpath discovery during analysis?",
      parsed["auto-system-classpath"]
        ? toBoolean(parsed["auto-system-classpath"])
        : defaults.autoSystemClasspathEnabled
    );
    const systemClasspathRoots = autoSystemClasspath
      ? parsePathList(
          await prompts.optionalText(
            "Optional system classpath search roots (OS path separator)",
            parsed["system-classpath-roots"] ?? undefined
          )
        )
      : [];
    const systemClasspathMaxRetries = autoSystemClasspath
      ? parseIntegerOption(
          await prompts.optionalText(
            "Auto classpath retry count",
            parsed["system-classpath-max-retries"] ?? "3"
          )
        )
      : undefined;

    const workerSuggested = parsed["use-worker"]
      ? toBoolean(parsed["use-worker"])
      : Boolean(parsed["worker-jar"] ?? defaults.workerJarAvailable);
    const useWorker = await prompts.confirm(
      "Enable Java worker for Java AST and Jasper JSP AST?",
      workerSuggested
    );

    let workerJar: string | undefined = parsed["worker-jar"] ?? undefined;
    if (useWorker && workerJar === undefined) {
      workerJar = await prompts.optionalText(
        "Optional worker JAR path (leave blank to use auto-detection)",
        undefined
      );
    }

    const jreHome = useWorker
      ? await prompts.optionalText("Optional JRE home", parsed["jre-home"] ?? undefined)
      : undefined;
    const javaHome = useWorker
      ? await prompts.optionalText("Optional JAVA_HOME", parsed["java-home"] ?? undefined)
      : undefined;
    const javaMavenCommand = useWorker
      ? await prompts.optionalText(
          "Optional Maven command for Java classpath auto-discovery",
          parsed["java-maven-command"] ?? defaults.javaMavenCommand
        )
      : undefined;
    const javaClasspath = useWorker
      ? parsePathList(
          await prompts.optionalText(
            "Optional extra Java classpath entries (OS path separator)",
            parsed["java-classpath"] ?? undefined
          )
        )
      : [];

    const jspAstMode = useWorker
      ? await prompts.selectJspAstMode(
          parsed["jsp-ast-mode"] ?? defaults.jspAstMode
        )
      : "lightweight";
    const webappRoot = await prompts.optionalText(
      "JSP webapp root",
      parsed["jsp-webapp-root"] ?? defaults.webappRoot
    );
    const jspMavenCommand = useWorker && jspAstMode === "jasper"
      ? await prompts.optionalText(
          "Optional Maven command for JSP classpath auto-discovery",
          parsed["jsp-maven-command"] ?? defaults.jspMavenCommand
        )
      : undefined;
    const jspClasspath = useWorker && jspAstMode === "jasper"
      ? parsePathList(
          await prompts.optionalText(
            "Optional extra JSP classpath entries (OS path separator)",
            parsed["jsp-classpath"] ?? undefined
          )
        )
      : [];
    const entryJava = splitPatternOption(
      await prompts.optionalText(
        "Entry Java file regexes (comma separated)",
        parsed["entry-java"] ?? undefined
      )
    );
    const entryJsp = splitPatternOption(
      await prompts.optionalText(
        "Entry JSP file regexes (comma separated)",
        parsed["entry-jsp"] ?? undefined
      )
    );

    return {
      analysisOut,
      ignoreFile,
      labelsOut,
      autoSystemClasspath,
      systemClasspathRoots,
      systemClasspathMaxRetries,
      useWorker,
      workerJar,
      jreHome,
      javaHome,
      javaClasspath,
      javaMavenCommand,
      jspAstMode,
      webappRoot,
      jspClasspath,
      jspMavenCommand,
      entryJava,
      entryJsp
    };
  });
}

async function withPrompts<T>(callback: (prompts: ReturnType<typeof createPrompts>) => Promise<T>): Promise<T> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await callback(createPrompts(rl));
  } finally {
    rl.close();
  }
}

function createPrompts(rl: readline.Interface) {
  return {
    async text(label: string, defaultValue: string): Promise<string> {
      while (true) {
        const answer = (await rl.question(formatQuestion(label, defaultValue))).trim();
        const value = answer || defaultValue;
        if (value) {
          return value;
        }
      }
    },
    async optionalText(label: string, defaultValue?: string): Promise<string | undefined> {
      const answer = (await rl.question(formatQuestion(label, defaultValue))).trim();
      if (answer) {
        return answer;
      }
      return defaultValue || undefined;
    },
    async confirm(label: string, defaultValue: boolean): Promise<boolean> {
      const defaultLabel = defaultValue ? "Y/n" : "y/N";
      while (true) {
        const answer = (await rl.question(`${label} [${defaultLabel}]: `)).trim().toLowerCase();
        if (!answer) {
          return defaultValue;
        }
        if (["y", "yes"].includes(answer)) {
          return true;
        }
        if (["n", "no"].includes(answer)) {
          return false;
        }
      }
    },
    async selectJspAstMode(defaultValue: string): Promise<JspAstMode> {
      while (true) {
        const answer = (await rl.question(
          `JSP AST mode [${defaultValue}] (jasper/lightweight): `
        )).trim();
        const value = normalizeJspAstMode(answer || defaultValue);
        if (value) {
          return value;
        }
      }
    }
  };
}

function formatQuestion(label: string, defaultValue?: string): string {
  return defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
}

async function detectWebappRoot(root: string): Promise<string | undefined> {
  const candidates = [
    "src/main/webapp",
    "src/main/webapp/WEB-INF",
    "webapp",
    "web"
  ];

  for (const candidate of candidates) {
    if (await isDirectory(path.join(root, candidate))) {
      return candidate;
    }
  }

  return undefined;
}

async function detectMavenCommand(root: string): Promise<string | undefined> {
  if (await fileExists(path.join(root, "mvnw"))) {
    return "./mvnw";
  }
  if (await fileExists(path.join(root, "pom.xml"))) {
    return "mvn";
  }
  return undefined;
}

function splitListOption(value?: string): string[] {
  return parsePathList(value);
}

function splitPatternOption(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePathList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIntegerOption(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeJspAstMode(value?: string): JspAstMode | undefined {
  if (value === "jasper" || value === "lightweight") {
    return value;
  }
  return undefined;
}

function deriveLabelsPath(analysisOut: string): string {
  return joinPosix(analysisOut, "index", "labels.json");
}

function normalizePathValue(root: string, target: string): string {
  if (path.isAbsolute(target)) {
    return ensureDotSlash(toPosix(path.relative(root, target)));
  }
  return ensureDotSlash(toPosix(target));
}

function normalizeCommandValue(root: string, value: string): string {
  if (!value) {
    return value;
  }
  if (path.isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes("\\")) {
    return normalizePathValue(root, value);
  }
  return value;
}

function ensureDotSlash(value: string): string {
  if (!value || value === ".") {
    return "./";
  }
  return value.startsWith("./") || value.startsWith("../") ? value : `./${value}`;
}

function joinPosix(...parts: string[]): string {
  return toPosix(path.join(...parts));
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function toBoolean(value: string): boolean {
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
