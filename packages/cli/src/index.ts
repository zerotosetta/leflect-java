#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

import {
  buildJspInputManifest,
  buildJavaInputManifest,
  buildStageIncrementalPlan,
  createCacheKey,
  createStageCacheState,
  ensureCacheDir,
  loadConfig,
  readFileHashesCache,
  readStageCacheState,
  removeRelativeJsonFiles,
  writeStageCacheState
} from "@lefectjava/core";
import {
  buildGraphs,
  GraphClassRecord,
  GraphJspRecord,
  JavaCallRecord,
  writeGraphFiles
} from "@lefectjava/graph";
import {
  buildJavaIndex,
  buildJspIndex,
  buildReverseIndex,
  writeJavaIndex,
  writeJspIndex,
  writeReverseIndex
} from "@lefectjava/indexer";
import { runJavaWorker, writeJavaManifest, writeJspManifest } from "@lefectjava/java-bridge";
import {
  buildLabelsIndex,
  LabelerClassRecord,
  LabelerJspRecord,
  LabelerMethodRecord,
  writeLabelsIndex
} from "@lefectjava/labeler";
import {
  attachJspAstReference,
  JspParseResult,
  parseJsp,
  resolveTagHandlers,
  writeJspMeta
} from "@lefectjava/parser-jsp";
import { parseTld, TldIndex } from "@lefectjava/parser-tld";
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
type StageName = "java-parse" | "jsp-parse" | "tld-parse";
type PreparedStageContext<TEntry = never> = {
  cacheKey: string;
  statePath: string;
  fileHashesCache: Awaited<ReturnType<typeof readFileHashesCache>>;
  previousState: Awaited<ReturnType<typeof readStageCacheState<TEntry>>>;
  plan: {
    reason: "initial" | "invalidated" | "changed" | "cache-hit";
    selectedFiles: string[];
    removedFiles: string[];
    unchangedFiles: string[];
  };
};

const PIPELINE_VERSION = "0.1.0";

export async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(PIPELINE_VERSION);
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
    case "parse-tld":
      await runParseTld(rest);
      return;
    case "build-index":
      await runBuildIndex(rest);
      return;
    case "build-graph":
      await runBuildGraph(rest);
      return;
    case "analyze":
      await runAnalyze(rest);
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
  const incremental = parsed["incremental"] === "true";

  const result = await scanWorkspace({
    root: config.root,
    analysisOut: config.analysisOut,
    ignoreFile: config.ignoreFile
  });

  console.log(`Scan complete. Output: ${config.analysisOut}`);
  if (incremental) {
    console.log(
      `Changed: ${result.changedFiles.length}, Removed: ${result.removedFiles.length}`
    );
  }
}

async function runParseJava(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  const incremental = parsed["incremental"] === "true";
  const workerJar = config.java?.workerJar;

  if (!workerJar) {
    throw new Error("Config 'java.workerJar' is required for parse-java");
  }

  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "java-files.json"));
  const stage = await prepareStageContext(
    "java-parse",
    config.analysisOut,
    files,
    createCacheKey({
      version: PIPELINE_VERSION,
      stage: "java-parse",
      java: config.java ?? {}
    }),
    incremental
  );

  if (stage.plan.reason === "cache-hit") {
    console.log("Java AST parse skipped (cache hit).");
    return;
  }

  if (stage.plan.removedFiles.length > 0) {
    await removeRelativeJsonFiles(path.join(config.analysisOut, "java-ast"), stage.plan.removedFiles);
  }

  if (stage.plan.selectedFiles.length === 0) {
    await persistStageState("java-parse", stage, files);
    console.log(`Java AST parse complete. Removed: ${stage.plan.removedFiles.length}`);
    return;
  }

  const manifest = buildJavaInputManifest(config, stage.plan.selectedFiles);
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

  await persistStageState("java-parse", stage, files);
  console.log(
    `Java AST parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`
  );
}

async function runParseJsp(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const baseConfig = await loadCliConfig(parsed);
  const incremental = parsed["incremental"] === "true";
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
  const astMode = config.jsp?.astMode ?? "lightweight";
  const metaDir = path.join(config.analysisOut, "jsp-meta");
  const astOutDir = config.jsp?.astOut ?? path.join(config.analysisOut, "jsp-ast");
  const stage = await prepareStageContext(
    "jsp-parse",
    config.analysisOut,
    files,
    createCacheKey({
      version: PIPELINE_VERSION,
      stage: "jsp-parse",
      java: config.java ?? {},
      jsp: config.jsp ?? {}
    }),
    incremental
  );

  if (stage.plan.reason === "cache-hit") {
    console.log("JSP parse skipped (cache hit).");
    return;
  }

  if (stage.plan.removedFiles.length > 0) {
    await removeRelativeJsonFiles(metaDir, stage.plan.removedFiles);
    await removeRelativeJsonFiles(astOutDir, stage.plan.removedFiles);
  }

  for (const file of stage.plan.selectedFiles) {
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

  if (astMode === "jasper" && stage.plan.selectedFiles.length > 0) {
    const workerJar = config.java?.workerJar;
    if (!workerJar) {
      throw new Error("Config 'java.workerJar' is required for parse-jsp with jasper mode");
    }

    const manifest = buildJspInputManifest(config, stage.plan.selectedFiles);
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

  await persistStageState("jsp-parse", stage, files);
  console.log(
    `JSP parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`
  );
}

async function runParseTld(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  const incremental = parsed["incremental"] === "true";
  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "tld-files.json"));
  const stage = await prepareStageContext<TldIndex>(
    "tld-parse",
    config.analysisOut,
    files,
    createCacheKey({
      version: PIPELINE_VERSION,
      stage: "tld-parse"
    }),
    incremental
  );

  if (stage.plan.reason === "cache-hit") {
    console.log("TLD parse skipped (cache hit).");
    return;
  }

  const entries: Record<string, TldIndex> =
    stage.previousState && stage.previousState.cacheKey === stage.cacheKey
      ? { ...(stage.previousState.entries ?? {}) }
      : {};

  for (const file of stage.plan.removedFiles) {
    delete entries[file];
  }

  for (const file of stage.plan.selectedFiles) {
    const absolutePath = path.join(config.root, file);
    const content = await fs.readFile(absolutePath, "utf8");
    entries[file] = parseTld(content);
  }

  const taglibs = files
    .map((file) => entries[file])
    .filter((entry): entry is TldIndex => entry !== undefined);

  await writeTaglibIndex(config.analysisOut, taglibs);
  await persistStageState("tld-parse", stage, files, entries);
  console.log(
    `TLD parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`
  );
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

async function runBuildIndex(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });

  const indexDir = path.join(config.analysisOut, "index");
  const javaFiles = await readScannerManifest(path.join(config.analysisOut, "manifests", "java-files.json"));
  const taglibs = await readJsonArray<TldIndex>(path.join(indexDir, "taglibs.json"));
  const jspDocs = await readJspMetaEntries(path.join(config.analysisOut, "jsp-meta"));
  const enrichedJspDocs = jspDocs.map((entry) => ({
    ...entry,
    resolvedTags: resolveTagHandlers(entry.tags, entry.taglibs, taglibs)
  }));

  const javaIndex = buildJavaIndex({ files: javaFiles });
  await writeJavaIndex(indexDir, javaIndex);
  await writeJspIndex(indexDir, buildJspIndex(enrichedJspDocs));
  await writeReverseIndex(
    indexDir,
    buildReverseIndex(
      enrichedJspDocs.flatMap((entry) =>
        (entry.resolvedTags ?? []).map((tag) => ({
          ...tag,
          jspPath: entry.path
        }))
      )
    )
  );

  console.log(`Index build complete. Output: ${indexDir}`);
}

async function runAnalyze(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);

  await runScan(args);
  await runParseTld(args);
  await runParseJsp(args);

  if (config.java?.workerJar) {
    await runParseJava(args);
  } else {
    console.log("Java parse skipped. Config 'java.workerJar' is not set.");
  }

  await runBuildIndex(args);
  await runBuildGraph(args);
  await runReport(["summary", ...args]);
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
  console.log("  parse-tld           Parse TLD files and write taglibs.json");
  console.log("  build-index         Build analysis indexes from manifests and parsed outputs");
  console.log("  build-graph         Build graph outputs and labels.json from analysis indexes");
  console.log("  analyze             Run the end-to-end analysis pipeline");
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
  console.log("  --labels-out <path>  Label output path (default: analysisOut/index/labels.json)");
  console.log("  --file <path>        Target JSP path for query jsp-impact");
  console.log("  --class <name>       Target Java/tag handler class for queries");
  console.log("  --format <type>      Query output format: text | json");
  console.log("  --incremental        Use cache state and process only changed files");
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
  const analysisOut =
    directOverrides.analysisOut ??
    (parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined) ??
    (parsed["out"] ? path.resolve(parsed["out"]) : undefined);
  const labelsOut =
    directOverrides.labelsOut ??
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

async function prepareStageContext<TEntry = never>(
  stageName: StageName,
  analysisOut: string,
  files: string[],
  cacheKey: string,
  incremental: boolean
): Promise<PreparedStageContext<TEntry>> {
  const cacheDir = await ensureCacheDir(analysisOut);
  const fileHashesCache = await readFileHashesCache(path.join(cacheDir, "file-hashes.json"));
  const statePath = path.join(cacheDir, `${stageName}-state.json`);
  const previousState = await readStageCacheState<TEntry>(statePath);
  const plan =
    incremental && fileHashesCache
      ? buildStageIncrementalPlan(files, fileHashesCache.files, previousState, cacheKey)
      : {
          reason: "initial" as const,
          selectedFiles: [...files],
          removedFiles: previousState
            ? Object.keys(previousState.files).filter((file) => !files.includes(file))
            : [],
          unchangedFiles: []
        };

  return {
    cacheKey,
    statePath,
    fileHashesCache,
    previousState,
    plan
  };
}

async function persistStageState<TEntry>(
  stageName: StageName,
  stage: PreparedStageContext<TEntry>,
  files: string[],
  entries?: Record<string, TEntry>
): Promise<void> {
  if (!stage.fileHashesCache) {
    return;
  }

  await writeStageCacheState(
    stage.statePath,
    createStageCacheState(stageName, stage.cacheKey, files, stage.fileHashesCache.files, entries)
  );
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

async function writeTaglibIndex(analysisOut: string, taglibs: TldIndex[]): Promise<void> {
  const indexDir = path.join(analysisOut, "index");
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, "taglibs.json"), JSON.stringify(taglibs, null, 2));
}

async function readJspMetaEntries(metaDir: string): Promise<Array<Record<string, unknown> & {
  path: string;
} & JspParseResult>> {
  const files = await listFiles(metaDir);
  const entries: Array<{ path: string } & JspParseResult> = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const raw = await fs.readFile(file, "utf8");
    entries.push(JSON.parse(raw) as { path: string } & JspParseResult);
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return listFiles(fullPath);
        }
        return [fullPath];
      })
    );
    return files.flat();
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
