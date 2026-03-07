import fs from "fs/promises";
import path from "path";

import { buildJspInputManifest, buildJavaInputManifest, loadConfig } from "@lefectjava/core";
import {
  buildGraphs,
  GraphClassRecord,
  GraphJspRecord,
  JavaCallRecord,
  writeGraphFiles
} from "@lefectjava/graph";
import { runJavaWorker, writeJavaManifest, writeJspManifest } from "@lefectjava/java-bridge";
import {
  buildLabelsIndex,
  LabelerClassRecord,
  LabelerJspRecord,
  LabelerMethodRecord,
  writeLabelsIndex
} from "@lefectjava/labeler";
import { attachJspAstReference, parseJsp, writeJspMeta } from "@lefectjava/parser-jsp";
import {
  buildReports,
  formatJavaUsagesResult,
  formatJspImpactResult,
  formatTagUsagesResult,
  queryJavaUsages,
  queryJspImpact,
  queryTagUsages,
  readReporterInput,
  writeReports
} from "@lefectjava/reporter";
import { scanWorkspace } from "@lefectjava/scanner";

type OutputFormat = "json" | "text";

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
    case "build-graph":
      await runBuildGraph(rest);
      return;
    case "report":
      await runReport(rest);
      return;
    case "query":
      await runQuery(rest);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function runScan(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);

  await scanWorkspace({
    root: config.root,
    analysisOut: config.analysisOut,
    ignoreFile: config.ignoreFile
  });

  console.log(`Scan complete. Output: ${config.analysisOut}`);
}

async function runParseJava(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);

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
  const baseConfig = await loadCliConfig(parsed);
  const astModeOverride: "jasper" | "lightweight" =
    parsed["jsp-ast-mode"] === "jasper" ? "jasper" : "lightweight";

  const config = parsed["jsp-ast-mode"]
    ? {
        ...baseConfig,
        jsp: {
          ...baseConfig.jsp,
          astMode: astModeOverride
        }
      }
    : baseConfig;

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

async function runBuildGraph(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });

  const indexDir = path.join(config.analysisOut, "index");
  const classes = await readJsonArray<GraphClassRecord & LabelerClassRecord>(
    path.join(indexDir, "classes.json")
  );
  const methods = await readJsonArray<LabelerMethodRecord>(path.join(indexDir, "methods.json"));
  const calls = await readJsonArray<JavaCallRecord>(path.join(indexDir, "calls.json"));
  const jspDocs = await readJsonArray<GraphJspRecord & LabelerJspRecord>(
    path.join(indexDir, "jsp-docs.json")
  );

  const graphs = buildGraphs(calls, jspDocs, classes);
  await writeGraphFiles(config.analysisOut, graphs);

  const labels = buildLabelsIndex({
    classes,
    methods,
    jsps: jspDocs.map((entry) => ({ path: entry.path }))
  });
  await writeLabelsIndex(config.labelsOut ?? path.join(indexDir, "labels.json"), labels);

  console.log(`Graph build complete. Output: ${path.join(config.analysisOut, "graph")}`);
}

async function runReport(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseArgs(rest);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });

  const input = await readReporterInput(config.analysisOut, config.labelsOut);
  const reports = buildReports(input);
  await writeReports(config.analysisOut, reports);

  switch (subcommand) {
    case "summary":
      console.log(JSON.stringify(reports.summary, null, 2));
      return;
    case "unresolved":
      console.log(JSON.stringify(reports.unresolved, null, 2));
      return;
    case "impact":
      console.log(reports.impactMarkdown);
      return;
    default:
      throw new Error("Report command requires one of: summary | unresolved | impact");
  }
}

async function runQuery(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseArgs(rest);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });
  const format = resolveFormat(parsed["format"]);
  const input = await readReporterInput(config.analysisOut, config.labelsOut);

  switch (subcommand) {
    case "jsp-impact": {
      const targetFile = parsed["file"];
      if (!targetFile) {
        throw new Error("query jsp-impact requires --file <path>");
      }

      const result = queryJspImpact(input, targetFile);
      printResult(result, format, formatJspImpactResult(result));
      return;
    }
    case "java-usages": {
      const targetClass = parsed["class"];
      if (!targetClass) {
        throw new Error("query java-usages requires --class <name>");
      }

      const result = queryJavaUsages(input, targetClass);
      printResult(result, format, formatJavaUsagesResult(result));
      return;
    }
    case "tag-usages": {
      const targetClass = parsed["class"];
      if (!targetClass) {
        throw new Error("query tag-usages requires --class <name>");
      }

      const result = queryTagUsages(input, targetClass);
      printResult(result, format, formatTagUsagesResult(result));
      return;
    }
    default:
      throw new Error("Query command requires one of: jsp-impact | java-usages | tag-usages");
  }
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
  console.log("  scan                Scan repository and build file inventory");
  console.log("  parse-java          Convert Java source files to JavaParser AST JSON");
  console.log("  parse-jsp           Parse JSP metadata and optionally Jasper->JavaParser AST");
  console.log("  build-graph         Build graph outputs and labels.json from analysis indexes");
  console.log("  report <subcommand> Generate report artifacts and print one result");
  console.log("  query <subcommand>  Query analysis outputs");
  console.log("\nReport Subcommands:");
  console.log("  summary             Write report files and print summary.json");
  console.log("  unresolved          Write report files and print unresolved.json");
  console.log("  impact              Write report files and print impact.md");
  console.log("\nQuery Subcommands:");
  console.log("  jsp-impact          Query JSP -> Java / TagHandler impact");
  console.log("  java-usages         Query callers/usages for a Java class");
  console.log("  tag-usages          Query JSP usages for a tag handler");
  console.log("\nOptions:");
  console.log("  --root <path>        Repository root");
  console.log("  --analysis <path>    Analysis directory (for build-graph/report/query)");
  console.log("  --out <path>         Analysis output directory");
  console.log("  --config <path>      Config file path (default: <root>/leflect.config.json)");
  console.log("  --ignore-file <path> Ignore rules file (.gitignore syntax)");
  console.log("  --jsp-ast-mode <m>   JSP AST mode: lightweight | jasper");
  console.log("  --labels-out <path>  Label output path (default: analysis/index/labels.json)");
  console.log("  --file <path>        Target JSP path for query jsp-impact");
  console.log("  --class <name>       Target Java/tag handler class for queries");
  console.log("  --format <type>      Query output format: text | json");
  console.log("  -h, --help           Show help");
  console.log("  -v, --version        Show version");
}

async function loadCliConfig(
  parsed: Record<string, string>,
  directOverrides: Partial<{ analysisOut: string; labelsOut: string }> = {}
) {
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"] ? path.resolve(parsed["config"]) : undefined;
  const ignoreFile = parsed["ignore-file"] ? path.resolve(parsed["ignore-file"]) : undefined;
  const analysisOut = directOverrides.analysisOut ??
    (parsed["out"] ? path.resolve(parsed["out"]) : undefined);
  const labelsOut = directOverrides.labelsOut ??
    (parsed["labels-out"] ? path.resolve(parsed["labels-out"]) : undefined);

  const { config } = await loadConfig({
    root,
    configPath,
    overrides: buildOverrides({
      analysisOut,
      ignoreFile,
      labelsOut
    })
  });

  return config;
}

function buildOverrides<T extends Record<string, unknown>>(overrides: T): Partial<T> {
  const entries = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}

function resolveFormat(value?: string): OutputFormat {
  return value === "json" ? "json" : "text";
}

function printResult(payload: unknown, format: OutputFormat, textOutput: string): void {
  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(textOutput);
}

async function readScannerManifest(manifestPath: string): Promise<string[]> {
  const raw = await fs.readFile(manifestPath, "utf8");
  const payload = JSON.parse(raw) as { files?: string[] };
  return payload.files ?? [];
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw) as T[];
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
