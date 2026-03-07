import fs from "fs/promises";
import path from "path";

import { buildJavaInputManifest, buildJspInputManifest, loadConfig } from "@lefectjava/core";
import { runJavaWorker, writeJavaManifest, writeJspManifest } from "@lefectjava/java-bridge";
import { attachJspAstReference, parseJsp, writeJspMeta } from "@lefectjava/parser-jsp";
import { scanWorkspace } from "@lefectjava/scanner";

export async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log("0.1.0");
    return;
  }

  switch (command) {
    case "scan":
      await runScan(rest);
      return;
    case "parse-java":
      await runParseJava(rest);
      return;
    case "parse-jsp":
      await runParseJsp(rest);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function runScan(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"] ? path.resolve(parsed["config"]) : undefined;
  const ignoreFile = parsed["ignore-file"] ? path.resolve(parsed["ignore-file"]) : undefined;
  const analysisOut = parsed["out"] ? path.resolve(parsed["out"]) : undefined;

  const { config } = await loadConfig({
    root,
    configPath,
    overrides: buildOverrides({
      analysisOut,
      ignoreFile
    })
  });

  await scanWorkspace({
    root: config.root,
    analysisOut: config.analysisOut,
    ignoreFile: config.ignoreFile
  });

  console.log(`Scan complete. Output: ${config.analysisOut}`);
}

async function runParseJava(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"] ? path.resolve(parsed["config"]) : undefined;
  const analysisOut = parsed["out"] ? path.resolve(parsed["out"]) : undefined;

  const { config } = await loadConfig({
    root,
    configPath,
    overrides: buildOverrides({
      analysisOut
    })
  });

  const workerJar = config.java?.workerJar;
  if (!workerJar) {
    throw new Error("Config 'java.workerJar' is required for parse-java");
  }

  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "java-files.json"));
  const manifest = buildJavaInputManifest(config, files);
  const manifestPath = path.join(config.analysisOut, "manifests", "java-parse.json");
  await writeJavaManifest(manifestPath, manifest);

  const result = await runJavaWorker({
    javaHome: config.java?.javaHome,
    jarPath: workerJar,
    args: ["parse-java", "--manifest", manifestPath],
    cwd: config.root
  });

  if (result.code !== 0) {
    throw new Error(result.stderr || `Java worker failed with exit code ${result.code}`);
  }

  console.log(`Java AST parse complete. Output: ${manifest.outputDir}`);
}

async function runParseJsp(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"] ? path.resolve(parsed["config"]) : undefined;
  const analysisOut = parsed["out"] ? path.resolve(parsed["out"]) : undefined;

  const loaded = await loadConfig({
    root,
    configPath,
    overrides: buildOverrides({
      analysisOut
    })
  });
  const astModeOverride: "jasper" | "lightweight" =
    parsed["jsp-ast-mode"] === "jasper" ? "jasper" : "lightweight";

  const config = parsed["jsp-ast-mode"]
    ? {
        ...loaded.config,
        jsp: {
          ...loaded.config.jsp,
          astMode: astModeOverride
        }
      }
    : loaded.config;

  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "jsp-files.json"));
  const metaDir = path.join(config.analysisOut, "jsp-meta");
  const astMode = config.jsp?.astMode ?? "lightweight";
  const astOutDir = config.jsp?.astOut ?? path.join(config.analysisOut, "jsp-ast");

  for (const file of files) {
    const absolutePath = path.join(config.root, file);
    const content = await fs.readFile(absolutePath, "utf8");
    const parsedJsp = parseJsp(content);
    const withAst = attachJspAstReference(
      parsedJsp,
      astMode === "jasper"
        ? {
            mode: "jasper",
            astPath: toAnalysisRelative(config.analysisOut, path.join(astOutDir, `${file}.json`))
          }
        : { mode: "lightweight" }
    );

    await writeJspMeta(metaDir, file, withAst);
  }

  if (astMode === "jasper") {
    const workerJar = config.java?.workerJar;
    if (!workerJar) {
      throw new Error("Config 'java.workerJar' is required for parse-jsp with jasper mode");
    }

    const manifest = buildJspInputManifest(config, files);
    const manifestPath = path.join(config.analysisOut, "manifests", "jsp-parse.json");
    await writeJspManifest(manifestPath, manifest);

    const result = await runJavaWorker({
      javaHome: config.java?.javaHome,
      jarPath: workerJar,
      args: ["parse-jsp", "--manifest", manifestPath],
      cwd: config.root
    });

    if (result.code !== 0) {
      throw new Error(result.stderr || `Java worker failed with exit code ${result.code}`);
    }
  }

  console.log(`JSP parse complete. Output: ${metaDir}`);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];

    if (!value.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = args[i + 1];

    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = next;
    i += 1;
  }

  return result;
}

function printHelp(): void {
  console.log("LeflectJava CLI (scaffold)");
  console.log("\nUsage:\n  leflect <command> [options]\n");
  console.log("Commands:");
  console.log("  scan            Scan repository and build file inventory");
  console.log("  parse-java      Convert Java source files to JavaParser AST JSON");
  console.log("  parse-jsp       Parse JSP metadata and optionally Jasper->JavaParser AST");
  console.log("\nOptions:");
  console.log("  --root <path>        Repository root");
  console.log("  --out <path>         Analysis output directory");
  console.log("  --config <path>      Config file path (default: <root>/leflect.config.json)");
  console.log("  --ignore-file <path> Ignore rules file (.gitignore syntax)");
  console.log("  --jsp-ast-mode <m>   JSP AST mode: lightweight | jasper");
  console.log("  -h, --help           Show help");
  console.log("  -v, --version        Show version");
}

function buildOverrides<T extends Record<string, unknown>>(overrides: T): Partial<T> {
  const entries = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}

async function readScannerManifest(manifestPath: string): Promise<string[]> {
  const raw = await fs.readFile(manifestPath, "utf8");
  const payload = JSON.parse(raw) as { files?: string[] };
  return payload.files ?? [];
}

function toAnalysisRelative(analysisOut: string, target: string): string {
  return path.relative(analysisOut, target).split(path.sep).join("/");
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
