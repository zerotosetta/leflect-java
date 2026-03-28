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
  resolveDefaultConfigPath,
  writeConfigRegistryArtifacts,
  writeStageCacheState
} from "@leflect-java/core";
import {
  buildGraphs,
  GraphClassRecord,
  GraphJspRecord,
  JavaCallRecord,
  writeGraphFiles
} from "@leflect-java/graph";
import {
  buildJavaIndex,
  buildJspIndex,
  buildReverseIndex,
  buildTaglibIndex,
  flattenJavaFileMetadata,
  flattenJspFileMetadata,
  readJavaFileMetadataDir,
  readJavaSummaryIndex,
  readJspFileMetadataDir,
  writeJavaIndex,
  writeJspIndex,
  writeReverseIndex,
  writeTaglibIndex
} from "@leflect-java/indexer";
import { runJavaWorker, writeJavaManifest, writeJspManifest } from "@leflect-java/java-bridge";
import {
  buildLabelsIndex,
  LabelerClassRecord,
  LabelerJspRecord,
  LabelerMethodRecord,
  writeLabelsIndex
} from "@leflect-java/labeler";
import {
  attachJspAstReference,
  JspParseResult,
  parseJsp,
  resolveTagHandlers,
  writeJspMeta
} from "@leflect-java/parser-jsp";
import { parseTld, TldIndex } from "@leflect-java/parser-tld";
import {
  buildReports,
  formatJavaUsagesResult,
  formatJspImpactResult,
  formatTagUsagesResult,
  queryJavaUsages,
  queryJspImpact,
  queryTagUsages,
  readReporterInput,
  ReporterArtifacts,
  writeReports
} from "@leflect-java/reporter";
import { scanWorkspace, ScanResult } from "@leflect-java/scanner";
import { LeflectConfig, SummaryReport } from "@leflect-java/schema";

import {
  discoverSystemClasspathEntries,
  extractMissingClassQueries,
  extractMissingClassQueriesFromText,
  extractMissingTaglibUriQueries,
  isSystemClasspathDiscoveryEnabled,
  readParseProblems,
  resolveSystemClasspathMaxRetries,
  resolveSystemClasspathSearchRoots
} from "./auto-classpath";
import { runDashboardDev } from "./dashboard-dev";
import { ConfigFileFormat, runInitCommand } from "./init";
import { createJavaDependencyCacheInput, resolveJavaClasspathEntries } from "./java-classpath";
import { createJspDependencyCacheInput, resolveJspClasspathEntries } from "./jsp-classpath";
import { runPluginScaffoldCommand } from "./plugin-scaffold";
import { runProjectionServer } from "./projection-server";
import { resolveJavaWorkerJar } from "./worker-jar";

type OutputFormat = "json" | "text";
type StageName = "java-parse" | "jsp-parse" | "tld-parse";
type CliConfig = LeflectConfig;
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
type AnalyzeStageName =
  | "scan"
  | "parse-tld"
  | "parse-jsp"
  | "parse-java"
  | "build-index"
  | "build-graph"
  | "report-summary";
type CommandOutput = {
  status(message: string): void;
  text(message: string): void;
  json(payload: unknown): void;
  error(message: string): void;
};
type StageRuntime = {
  output: CommandOutput;
  onEvent?: (event: AnalyzeEvent) => void;
};
type ScanStageExecution = {
  scan: ScanResult;
  stage: AnalyzeStageResult;
};
type ReportStageExecution = {
  reports: ReporterArtifacts;
  stage: AnalyzeStageResult;
};

const PIPELINE_VERSION = "0.1.0";

export type AnalyzeEvent = {
  stage: AnalyzeStageName;
  status: "start" | "completed" | "skipped";
  message: string;
  detail?: Record<string, unknown>;
};

export type AnalyzeStageResult = {
  stage: AnalyzeStageName;
  status: "completed" | "skipped";
  outputPath?: string;
  reason?: string;
  totalFiles?: number;
  processedFiles?: number;
  changedFiles?: number;
  removedFiles?: number;
};

export type AnalyzeWorkspaceOptions = {
  root?: string;
  configPath?: string;
  analysisOut?: string;
  ignoreFile?: string;
  labelsOut?: string;
  incremental?: boolean;
  jspAstMode?: "jasper" | "lightweight";
  classpathDiscovery?: LeflectConfig["classpathDiscovery"];
  onEvent?: (event: AnalyzeEvent) => void;
};

export type AnalyzeWorkspaceResult = {
  analysisOut: string;
  config: LeflectConfig;
  worker: {
    requested: boolean;
    resolvedJar?: string;
    ran: boolean;
    skipReason?: string;
  };
  stages: AnalyzeStageResult[];
  reports: {
    summary: SummaryReport;
  };
};

export async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const output = createCommandOutput();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(output);
    return;
  }

  if (command === "--version" || command === "-v") {
    output.text(PIPELINE_VERSION);
    return;
  }

  switch (command) {
    case "init":
      await runInit(rest);
      return;
    case "scaffold-plugin":
      await runScaffoldPlugin(rest);
      return;
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
    case "dashboard-server":
      await runDashboardServer(rest);
      return;
    case "dashboard-dev":
      await runDashboardDevCommand(rest);
      return;
    default:
      output.error(`Unknown command: ${command}`);
      printHelp(output);
      process.exitCode = 1;
  }
}

export async function analyzeWorkspace(
  options: AnalyzeWorkspaceOptions
): Promise<AnalyzeWorkspaceResult> {
  return analyzeWorkspaceInternal(options, {
    output: createSilentOutput(),
    onEvent: options.onEvent
  });
}

function createCommandOutput(options: { quiet?: boolean } = {}): CommandOutput {
  return {
    status(message) {
      if (!options.quiet) {
        console.log(message);
      }
    },
    text(message) {
      console.log(message);
    },
    json(payload) {
      console.log(JSON.stringify(payload, null, 2));
    },
    error(message) {
      console.error(message);
    }
  };
}

function createSilentOutput(): CommandOutput {
  return {
    status() {
    },
    text() {
    },
    json() {
    },
    error() {
    }
  };
}

function emitAnalyzeEvent(runtime: StageRuntime, event: AnalyzeEvent): void {
  runtime.onEvent?.(event);
}

async function analyzeWorkspaceInternal(
  options: AnalyzeWorkspaceOptions,
  runtime: StageRuntime
): Promise<AnalyzeWorkspaceResult> {
  const config = await loadExecutionConfig({
    root: options.root,
    configPath: options.configPath,
    analysisOut: options.analysisOut,
    ignoreFile: options.ignoreFile,
    labelsOut: options.labelsOut,
    classpathDiscovery: options.classpathDiscovery,
    jspAstMode: options.jspAstMode
  });
  const incremental = options.incremental === true;
  const stages: AnalyzeStageResult[] = [];
  const workerJar = await resolveJavaWorkerJar(config.java?.workerJar);
  const worker = {
    requested: true,
    resolvedJar: workerJar,
    ran: false,
    skipReason: workerJar ? undefined : "Java worker JAR could not be resolved."
  };

  stages.push((await executeScanStage(config, incremental, runtime)).stage);
  stages.push((await executeParseTldStage(config, incremental, runtime)).stage);
  stages.push((await executeParseJspStage(config, incremental, runtime)).stage);

  if (workerJar) {
    const javaStage = await executeParseJavaStage(config, incremental, workerJar, runtime);
    worker.ran = javaStage.ranWorker;
    stages.push(javaStage.stage);
  } else {
    const message = "Java parse skipped. Java worker JAR could not be resolved.";
    runtime.output.status(message);
    emitAnalyzeEvent(runtime, {
      stage: "parse-java",
      status: "skipped",
      message,
      detail: { reason: "worker-jar-unresolved" }
    });
    stages.push({
      stage: "parse-java",
      status: "skipped",
      reason: "worker-jar-unresolved"
    });
  }

  stages.push((await executeBuildIndexStage(config, runtime)).stage);
  stages.push((await executeBuildGraphStage(config, runtime)).stage);
  const reportExecution = await executeReportSummaryStage(config, runtime);
  stages.push(reportExecution.stage);

  return {
    analysisOut: config.analysisOut,
    config,
    worker,
    stages,
    reports: {
      summary: reportExecution.reports.summary
    }
  };
}

async function executeScanStage(
  config: CliConfig,
  incremental: boolean,
  runtime: StageRuntime
): Promise<ScanStageExecution> {
  emitAnalyzeEvent(runtime, {
    stage: "scan",
    status: "start",
    message: `Scanning workspace: ${config.root}`,
    detail: { root: config.root, analysisOut: config.analysisOut }
  });

  const scan = await scanWorkspace({
    root: config.root,
    analysisOut: config.analysisOut,
    ignoreFile: config.ignoreFile
  });

  runtime.output.status(`Scan complete. Output: ${config.analysisOut}`);
  if (incremental) {
    runtime.output.status(
      `Changed: ${scan.changedFiles.length}, Removed: ${scan.removedFiles.length}`
    );
  }

  const stage: AnalyzeStageResult = {
    stage: "scan",
    status: "completed",
    outputPath: path.join(config.analysisOut, "files"),
    totalFiles: scan.totalFiles,
    changedFiles: incremental ? scan.changedFiles.length : undefined,
    removedFiles: incremental ? scan.removedFiles.length : undefined
  };

  emitAnalyzeEvent(runtime, {
    stage: "scan",
    status: "completed",
    message: `Scan complete. Output: ${config.analysisOut}`,
    detail: {
      totalFiles: scan.totalFiles,
      changedFiles: scan.changedFiles.length,
      removedFiles: scan.removedFiles.length
    }
  });

  return { scan, stage };
}

async function runScan(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  return (await executeScanStage(
    config,
    parsed["incremental"] === "true",
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function runInit(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const existingConfigPath = !parsed["config"] ? await resolveDefaultConfigPath(root) : undefined;
  const configPath = parsed["config"]
    ? path.resolve(parsed["config"])
    : existingConfigPath ?? path.join(root, defaultConfigName(parsed["config-format"]));
  const configFormat = resolveConfigFormat(parsed["config-format"], configPath);

  await runInitCommand({
    root,
    configPath,
    configFormat,
    force: parsed["force"] === "true",
    yes: parsed["yes"] === "true",
    parsed
  });
}

async function runScaffoldPlugin(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const output = createCommandOutput();
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"]
    ? path.resolve(parsed["config"])
    : await resolveDefaultConfigPath(root);
  const name = parsed["name"];
  if (!name) {
    throw new Error("scaffold-plugin requires --name <plugin-name>");
  }

  const target = resolvePluginTarget(parsed["target"]);
  const result = await runPluginScaffoldCommand({
    root,
    name,
    target,
    outputPath: parsed["plugin-out"],
    force: parsed["force"] === "true",
    configPath
  });

  output.text(`Plugin scaffold written: ${result.filePath}`);
  output.text(`Factory: ${result.factoryName}`);
  output.text(`Plugin name: ${result.pluginName}`);
  if (result.importPath && result.configPath) {
    output.text(`Add to ${result.configPath}:`);
    output.text(`  import { ${result.factoryName} } from "${result.importPath}";`);
    output.text(`  plugins: [${result.factoryName}()]`);
  }
}

async function executeParseJavaStage(
  config: CliConfig,
  incremental: boolean,
  workerJar: string,
  runtime: StageRuntime
): Promise<{ stage: AnalyzeStageResult; ranWorker: boolean }> {
  emitAnalyzeEvent(runtime, {
    stage: "parse-java",
    status: "start",
    message: `Parsing Java sources under ${config.root}`,
    detail: { analysisOut: config.analysisOut }
  });
  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "java-files.json"));
  const stage = await prepareStageContext(
    "java-parse",
    config.analysisOut,
    files,
    createCacheKey({
      version: PIPELINE_VERSION,
      stage: "java-parse",
      java: config.java ?? {},
      dependencies: await createJavaDependencyCacheInput(config)
    }),
    incremental
  );

  if (stage.plan.reason === "cache-hit") {
    const message = "Java AST parse skipped (cache hit).";
    runtime.output.status(message);
    emitAnalyzeEvent(runtime, {
      stage: "parse-java",
      status: "skipped",
      message,
      detail: { reason: "cache-hit" }
    });
    return {
      stage: {
        stage: "parse-java",
        status: "skipped",
        outputPath: path.join(config.analysisOut, "java-ast"),
        reason: "cache-hit"
      },
      ranWorker: false
    };
  }

  if (stage.plan.removedFiles.length > 0) {
    await removeRelativeJsonFiles(path.join(config.analysisOut, "java-ast"), stage.plan.removedFiles);
  }

  if (stage.plan.selectedFiles.length === 0) {
    await persistStageState("java-parse", stage, files);
    const message = `Java AST parse complete. Removed: ${stage.plan.removedFiles.length}`;
    runtime.output.status(message);
    emitAnalyzeEvent(runtime, {
      stage: "parse-java",
      status: "completed",
      message,
      detail: { processedFiles: 0, removedFiles: stage.plan.removedFiles.length }
    });
    return {
      stage: {
        stage: "parse-java",
        status: "completed",
        outputPath: path.join(config.analysisOut, "java-ast"),
        processedFiles: 0,
        removedFiles: stage.plan.removedFiles.length
      },
      ranWorker: false
    };
  }

  let classpathEntries = await resolveJavaClasspathEntries(config, stage.plan.selectedFiles);
  let manifest = buildJavaInputManifest(config, stage.plan.selectedFiles, classpathEntries);
  const manifestPath = path.join(config.analysisOut, "manifests", "java-parse.json");
  await writeJavaManifest(manifestPath, manifest);

  const maxRetries = isSystemClasspathDiscoveryEnabled(config)
    ? resolveSystemClasspathMaxRetries(config)
    : 0;
  let ranWorker = false;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    ranWorker = true;
    const result = await runJavaWorker({
      jreHome: config.java?.jreHome,
      javaHome: config.java?.javaHome,
      jarPath: workerJar,
      args: ["parse-java", "--manifest", manifestPath],
      cwd: config.root
    });

    if (result.code === 0) {
      break;
    }

    if (!isSystemClasspathDiscoveryEnabled(config) || attempt === maxRetries) {
      throw new Error(result.stderr || `Java worker failed with exit code ${result.code}`);
    }

    const discovered = await discoverSystemClasspathEntries({
      existingEntries: classpathEntries,
      searchRoots: resolveSystemClasspathSearchRoots(config),
      classQueries: extractMissingClassQueriesFromText(result.stderr || "")
    });

    if (discovered.length === 0) {
      throw new Error(result.stderr || `Java worker failed with exit code ${result.code}`);
    }

    classpathEntries = [...new Set([...classpathEntries, ...discovered])];
    manifest = buildJavaInputManifest(config, stage.plan.selectedFiles, classpathEntries);
    await writeJavaManifest(manifestPath, manifest);
  }

  await persistStageState("java-parse", stage, files);
  const message = `Java AST parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "parse-java",
    status: "completed",
    message,
    detail: {
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    }
  });

  return {
    stage: {
      stage: "parse-java",
      status: "completed",
      outputPath: path.join(config.analysisOut, "java-ast"),
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    },
    ranWorker
  };
}

async function runParseJava(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  const workerJar = await resolveJavaWorkerJar(config.java?.workerJar);

  if (!workerJar) {
    throw new Error(
      "Java worker JAR could not be resolved. Set 'java.workerJar' or LEFLECT_JAVA_WORKER_JAR."
    );
  }

  return (await executeParseJavaStage(
    config,
    parsed["incremental"] === "true",
    workerJar,
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function executeParseJspStage(
  config: CliConfig,
  incremental: boolean,
  runtime: StageRuntime
): Promise<{ stage: AnalyzeStageResult }> {
  emitAnalyzeEvent(runtime, {
    stage: "parse-jsp",
    status: "start",
    message: `Parsing JSP sources under ${config.root}`,
    detail: { astMode: config.jsp?.astMode ?? "jasper" }
  });
  const files = await readScannerManifest(path.join(config.analysisOut, "manifests", "jsp-files.json"));
  const astMode = config.jsp?.astMode ?? "jasper";
  const metaDir = path.join(config.analysisOut, "jsp-meta");
  const astOutDir = config.jsp?.astOut ?? path.join(config.analysisOut, "jsp-ast");
  const taglibUris = new Set<string>();
  const dependencyCacheInput =
    astMode === "jasper" ? await createJspDependencyCacheInput(config) : undefined;
  const stage = await prepareStageContext(
    "jsp-parse",
    config.analysisOut,
    files,
    createCacheKey({
      version: PIPELINE_VERSION,
      stage: "jsp-parse",
      java: config.java ?? {},
      jsp: config.jsp ?? {},
      dependencies: dependencyCacheInput
    }),
    incremental
  );

  if (stage.plan.reason === "cache-hit") {
    const message = "JSP parse skipped (cache hit).";
    runtime.output.status(message);
    emitAnalyzeEvent(runtime, {
      stage: "parse-jsp",
      status: "skipped",
      message,
      detail: { reason: "cache-hit" }
    });
    return {
      stage: {
        stage: "parse-jsp",
        status: "skipped",
        outputPath: metaDir,
        reason: "cache-hit"
      }
    };
  }

  if (stage.plan.removedFiles.length > 0) {
    await removeRelativeJsonFiles(metaDir, stage.plan.removedFiles);
    await removeRelativeJsonFiles(astOutDir, stage.plan.removedFiles);
  }

  for (const file of stage.plan.selectedFiles) {
    const absolutePath = path.join(config.root, file);
    const content = await fs.readFile(absolutePath, "utf8");
    const parsedJsp = parseJsp(content);
    for (const taglib of parsedJsp.taglibs) {
      if (taglib.uri) {
        taglibUris.add(taglib.uri);
      }
    }
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
    const workerJar = await resolveJavaWorkerJar(config.java?.workerJar);
    if (!workerJar) {
      throw new Error(
        "Java worker JAR could not be resolved for parse-jsp. Set 'java.workerJar' or LEFLECT_JAVA_WORKER_JAR."
      );
    }

    let classpathEntries = await resolveJspClasspathEntries(config, [...taglibUris]);
    let manifest = buildJspInputManifest(config, stage.plan.selectedFiles, classpathEntries);
    const manifestPath = path.join(config.analysisOut, "manifests", "jsp-parse.json");
    await writeJspManifest(manifestPath, manifest);

    const maxRetries = isSystemClasspathDiscoveryEnabled(config)
      ? resolveSystemClasspathMaxRetries(config)
      : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await runJavaWorker({
        jreHome: config.java?.jreHome,
        javaHome: config.java?.javaHome,
        jarPath: workerJar,
        args: ["parse-jsp", "--manifest", manifestPath],
        cwd: config.root
      });

      if (result.code !== 0) {
        throw new Error(result.stderr || `Java worker failed with exit code ${result.code}`);
      }

      if (!isSystemClasspathDiscoveryEnabled(config) || attempt === maxRetries) {
        break;
      }

      const problems = await readParseProblems(path.join(config.analysisOut, "logs", "jsp-parse-errors.jsonl"));
      if (problems.length === 0) {
        break;
      }

      const discovered = await discoverSystemClasspathEntries({
        existingEntries: classpathEntries,
        searchRoots: resolveSystemClasspathSearchRoots(config),
        classQueries: extractMissingClassQueries(problems),
        taglibUriQueries: extractMissingTaglibUriQueries(problems)
      });

      if (discovered.length === 0) {
        break;
      }

      classpathEntries = [...new Set([...classpathEntries, ...discovered])];
      manifest = buildJspInputManifest(config, stage.plan.selectedFiles, classpathEntries);
      await writeJspManifest(manifestPath, manifest);
    }
  }

  await persistStageState("jsp-parse", stage, files);
  const message = `JSP parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "parse-jsp",
    status: "completed",
    message,
    detail: {
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    }
  });

  return {
    stage: {
      stage: "parse-jsp",
      status: "completed",
      outputPath: metaDir,
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    }
  };
}

async function runParseJsp(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  return (await executeParseJspStage(
    config,
    parsed["incremental"] === "true",
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function executeParseTldStage(
  config: CliConfig,
  incremental: boolean,
  runtime: StageRuntime
): Promise<{ stage: AnalyzeStageResult }> {
  emitAnalyzeEvent(runtime, {
    stage: "parse-tld",
    status: "start",
    message: `Parsing TLD sources under ${config.root}`
  });
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
    const message = "TLD parse skipped (cache hit).";
    runtime.output.status(message);
    emitAnalyzeEvent(runtime, {
      stage: "parse-tld",
      status: "skipped",
      message,
      detail: { reason: "cache-hit" }
    });
    return {
      stage: {
        stage: "parse-tld",
        status: "skipped",
        outputPath: path.join(config.analysisOut, "index", "taglibs.json"),
        reason: "cache-hit"
      }
    };
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

  await writeRawTaglibIndex(config.analysisOut, taglibs);
  await persistStageState("tld-parse", stage, files, entries);

  const message = `TLD parse complete. Processed: ${stage.plan.selectedFiles.length}, Removed: ${stage.plan.removedFiles.length}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "parse-tld",
    status: "completed",
    message,
    detail: {
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    }
  });

  return {
    stage: {
      stage: "parse-tld",
      status: "completed",
      outputPath: path.join(config.analysisOut, "index", "taglibs.json"),
      processedFiles: stage.plan.selectedFiles.length,
      removedFiles: stage.plan.removedFiles.length
    }
  };
}

async function runParseTld(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed);
  return (await executeParseTldStage(
    config,
    parsed["incremental"] === "true",
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function executeBuildGraphStage(
  config: CliConfig,
  runtime: StageRuntime
): Promise<{ stage: AnalyzeStageResult }> {
  emitAnalyzeEvent(runtime, {
    stage: "build-graph",
    status: "start",
    message: `Building graph artifacts for ${config.analysisOut}`
  });
  const indexDir = path.join(config.analysisOut, "index");
  const javaMetadata = await readJavaFileMetadataDir(indexDir);
  const jspMetadata = await readJspFileMetadataDir(indexDir);
  const javaIndex = javaMetadata.length > 0 ? flattenJavaFileMetadata(javaMetadata) : undefined;
  const jspIndex = jspMetadata.length > 0 ? flattenJspFileMetadata(jspMetadata) : undefined;
  const classes = (
    javaIndex?.classes ??
    await readJsonArray<GraphClassRecord & LabelerClassRecord>(path.join(indexDir, "classes.json"))
  ) as Array<GraphClassRecord & LabelerClassRecord>;
  const methods = (
    javaIndex?.methods ??
    await readJsonArray<LabelerMethodRecord>(path.join(indexDir, "methods.json"))
  ) as LabelerMethodRecord[];
  const calls = (
    javaIndex?.calls ??
    await readJsonArray<JavaCallRecord>(path.join(indexDir, "calls.json"))
  ) as JavaCallRecord[];
  const jspDocs = (
    jspIndex?.docs ??
    await readJsonArray<GraphJspRecord & LabelerJspRecord>(path.join(indexDir, "jsp-docs.json"))
  ) as Array<GraphJspRecord & LabelerJspRecord>;

  const graphs = buildGraphs(calls, jspDocs, classes, {
    entryFiles: config.entryFiles,
    entries: config.entries,
    javaClassReferences: javaIndex?.classReferences
  });
  await writeGraphFiles(config.analysisOut, graphs);
  await writeConfigRegistryArtifacts(config);

  const labels = buildLabelsIndex({
    classes,
    methods,
    jsps: jspDocs.map((entry) => ({ path: entry.path }))
  });
  await writeLabelsIndex(config.labelsOut ?? path.join(indexDir, "labels.json"), labels);

  const outputPath = path.join(config.analysisOut, "graph");
  const message = `Graph build complete. Output: ${outputPath}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "build-graph",
    status: "completed",
    message,
    detail: { outputPath }
  });

  return {
    stage: {
      stage: "build-graph",
      status: "completed",
      outputPath
    }
  };
}

async function runBuildGraph(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });
  return (await executeBuildGraphStage(
    config,
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function executeBuildIndexStage(
  config: CliConfig,
  runtime: StageRuntime
): Promise<{ stage: AnalyzeStageResult }> {
  emitAnalyzeEvent(runtime, {
    stage: "build-index",
    status: "start",
    message: `Building index artifacts for ${config.analysisOut}`
  });
  const indexDir = path.join(config.analysisOut, "index");
  const javaFiles = await readScannerManifest(path.join(config.analysisOut, "manifests", "java-files.json"));
  const tldFiles = await readScannerManifest(path.join(config.analysisOut, "manifests", "tld-files.json"));
  const rawTaglibs = await readJsonArray<TldIndex>(path.join(indexDir, "taglibs.json"));
  const jspDocs = await readJspMetaEntries(path.join(config.analysisOut, "jsp-meta"));
  const javaSummaries = await readJavaSummaryIndex(path.join(indexDir, "java-summary.jsonl"));
  const tldIndexes = rawTaglibs.map((entry, index) => ({
    ...entry,
    sourcePath: tldFiles[index]
  }));
  const enrichedJspDocs = jspDocs.map((entry) => ({
    ...entry,
    resolvedTags: resolveTagHandlers(entry.tags, entry.taglibs, rawTaglibs)
  }));

  const javaIndex = buildJavaIndex({ files: javaFiles, summaries: javaSummaries });
  const jspIndex = buildJspIndex(enrichedJspDocs, {
    javaMethods: javaIndex.methods
  });
  const taglibIndex = buildTaglibIndex(tldIndexes, enrichedJspDocs);
  await writeJavaIndex(indexDir, javaIndex);
  await writeJspIndex(indexDir, jspIndex);
  await writeTaglibIndex(indexDir, taglibIndex);
  await writeReverseIndex(
    indexDir,
    buildReverseIndex({
      resolvedTags: enrichedJspDocs.flatMap((entry) =>
        (entry.resolvedTags ?? []).map((tag) => ({
          ...tag,
          jspPath: entry.path
        }))
      ),
      jspDocs: enrichedJspDocs,
      classes: javaIndex.classes,
      calls: javaIndex.calls
    })
  );

  const message = `Index build complete. Output: ${indexDir}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "build-index",
    status: "completed",
    message,
    detail: { outputPath: indexDir }
  });

  return {
    stage: {
      stage: "build-index",
      status: "completed",
      outputPath: indexDir
    }
  };
}

async function runBuildIndex(args: string[]): Promise<AnalyzeStageResult> {
  const parsed = parseArgs(args);
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });
  return (await executeBuildIndexStage(
    config,
    { output: createCommandOutput({ quiet: parsed["quiet"] === "true" }) }
  )).stage;
}

async function buildReportsForConfig(config: CliConfig): Promise<ReporterArtifacts> {
  const input = await readReporterInput(config.analysisOut, config.labelsOut);
  const reports = buildReports(input);
  await writeReports(config.analysisOut, reports);
  return reports;
}

async function executeReportSummaryStage(
  config: CliConfig,
  runtime: StageRuntime
): Promise<ReportStageExecution> {
  emitAnalyzeEvent(runtime, {
    stage: "report-summary",
    status: "start",
    message: `Writing report artifacts for ${config.analysisOut}`
  });
  const reports = await buildReportsForConfig(config);
  const outputPath = path.join(config.analysisOut, "report");
  const message = `Report build complete. Output: ${outputPath}`;
  runtime.output.status(message);
  emitAnalyzeEvent(runtime, {
    stage: "report-summary",
    status: "completed",
    message,
    detail: { outputPath }
  });

  return {
    reports,
    stage: {
      stage: "report-summary",
      status: "completed",
      outputPath
    }
  };
}

async function runAnalyze(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const format = resolveFormat(parsed["format"]);
  const output = createCommandOutput({
    quiet: parsed["quiet"] === "true" || format === "json"
  });
  const result = await analyzeWorkspaceInternal(buildAnalyzeOptionsFromArgs(parsed), {
    output
  });

  if (format === "json") {
    output.json(result);
    return;
  }

  output.json(result.reports.summary);
}

async function runReport(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseArgs(rest);
  const output = createCommandOutput();
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });

  const reports = await buildReportsForConfig(config);

  switch (subcommand) {
    case "summary":
      output.json(reports.summary);
      return;
    case "unresolved":
      output.json(reports.unresolved);
      return;
    case "impact":
      output.text(reports.impactMarkdown);
      return;
    default:
      throw new Error("Report command requires one of: summary | unresolved | impact");
  }
}

async function runQuery(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseArgs(rest);
  const output = createCommandOutput();
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
      printResult(output, result, format, formatJspImpactResult(result));
      return;
    }
    case "java-usages": {
      const targetClass = parsed["class"];
      if (!targetClass) {
        throw new Error("query java-usages requires --class <name>");
      }

      const result = queryJavaUsages(input, targetClass);
      printResult(output, result, format, formatJavaUsagesResult(result));
      return;
    }
    case "tag-usages": {
      const targetClass = parsed["class"];
      if (!targetClass) {
        throw new Error("query tag-usages requires --class <name>");
      }

      const result = queryTagUsages(input, targetClass);
      printResult(output, result, format, formatTagUsagesResult(result));
      return;
    }
    default:
      throw new Error("Query command requires one of: jsp-impact | java-usages | tag-usages");
  }
}

async function runDashboardServer(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"]
    ? path.resolve(parsed["config"])
    : await resolveDefaultConfigPath(root) ?? path.join(root, "leflect.config.json");
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });
  const appDir = await resolveDashboardAppDir(parsed["dashboard-app"]);
  if (!appDir) {
    throw new Error(
      "Dashboard app could not be resolved. Run inside the LeflectJava workspace or set LEFLECT_DASHBOARD_APP_DIR."
    );
  }

  await ensureDashboardArtifacts(config.analysisOut);

  const host = parsed["host"] ?? process.env.LEFLECT_DASHBOARD_HOST ?? "127.0.0.1";
  const port = parsed["port"]
    ? Number.parseInt(parsed["port"], 10)
    : Number.parseInt(process.env.LEFLECT_DASHBOARD_PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Option '--port' must be a positive integer");
  }

  const mode =
    parsed["mode"] === "production" || parsed["prod"] === "true" ? "production" : "development";

  await runProjectionServer({
    appDir,
    config,
    configPath,
    host,
    port,
    mode
  });
}

async function runDashboardDevCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const root = parsed["root"] ? path.resolve(parsed["root"]) : process.cwd();
  const configPath = parsed["config"]
    ? path.resolve(parsed["config"])
    : await resolveDefaultConfigPath(root) ?? path.join(root, "leflect.config.json");
  const config = await loadCliConfig(parsed, {
    analysisOut: parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
  });
  const appDir = await resolveDashboardAppDir(parsed["dashboard-app"]);
  if (!appDir) {
    throw new Error(
      "Dashboard app could not be resolved. Run inside the LeflectJava workspace or set LEFLECT_DASHBOARD_APP_DIR."
    );
  }

  await ensureDashboardArtifacts(config.analysisOut);

  const host = parsed["host"] ?? process.env.LEFLECT_DASHBOARD_HOST ?? "127.0.0.1";
  const apiPort = parsed["port"]
    ? Number.parseInt(parsed["port"], 10)
    : Number.parseInt(process.env.LEFLECT_DASHBOARD_PORT ?? "3000", 10);
  const frontendPort = parsed["dev-port"]
    ? Number.parseInt(parsed["dev-port"], 10)
    : Number.parseInt(process.env.LEFLECT_DASHBOARD_DEV_PORT ?? "4173", 10);

  if (!Number.isInteger(apiPort) || apiPort <= 0) {
    throw new Error("Option '--port' must be a positive integer");
  }

  if (!Number.isInteger(frontendPort) || frontendPort <= 0) {
    throw new Error("Option '--dev-port' must be a positive integer");
  }

  await runDashboardDev({
    appDir,
    config,
    configPath,
    host,
    apiPort,
    frontendPort
  });
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

function isJspAstMode(value: string): value is "jasper" | "lightweight" {
  return value === "jasper" || value === "lightweight";
}

function resolveJspAstMode(value?: string): "jasper" | "lightweight" | undefined {
  if (!value) {
    return undefined;
  }
  if (!isJspAstMode(value)) {
    throw new Error("Option '--jsp-ast-mode' must be 'lightweight' or 'jasper'");
  }
  return value;
}

function printHelp(output: CommandOutput): void {
  output.text("LeflectJava CLI (scaffold)");
  output.text("\nUsage:\n  leflect <command> [options]\n");
  output.text("Commands:");
  output.text("  init                Create leflect.config.ts or leflect.config.json with an interactive wizard");
  output.text("  scaffold-plugin     Generate a TypeScript plugin scaffold for leflect.config.ts projects");
  output.text("  scan                Scan repository and build file inventory");
  output.text("  parse-java          Convert Java source files to JavaParser AST JSON");
  output.text("  parse-jsp           Parse JSP metadata and Jasper->JavaParser AST by default");
  output.text("  parse-tld           Parse TLD files and write taglibs.json");
  output.text("  build-index         Build analysis indexes from manifests and parsed outputs");
  output.text("  build-graph         Build graph outputs and labels.json from analysis indexes");
  output.text("  analyze             Run the end-to-end analysis pipeline");
  output.text("  report <subcommand> Generate report artifacts and print one result");
  output.text("  query <subcommand>  Query analysis outputs");
  output.text("  dashboard-server    Start the Lit projection app against existing analysis outputs");
  output.text("  dashboard-dev       Start the API server and Vite dev server together");
  output.text("\nReport Subcommands:");
  output.text("  summary             Write report files and print summary.json");
  output.text("  unresolved          Write report files and print unresolved.json");
  output.text("  impact              Write report files and print impact.md");
  output.text("\nQuery Subcommands:");
  output.text("  jsp-impact          Query JSP -> Java / TagHandler impact");
  output.text("  java-usages         Query callers/usages for a Java class");
  output.text("  tag-usages          Query JSP usages for a tag handler");
  output.text("\nOptions:");
  output.text("  --root <path>        Repository root");
  output.text("  --analysis <path>    Analysis directory (for build-graph/report/query)");
  output.text("  --out <path>         Analysis output directory");
  output.text("  --config <path>      Config file path (default: discovered leflect.config.* or <root>/leflect.config.json)");
  output.text("  --config-format <f>  Config format for init: json | ts");
  output.text("  --name <value>       Plugin scaffold name");
  output.text("  --target <value>     Plugin hook target for scaffold-plugin: java | jsp | common");
  output.text("  --plugin-out <path>  Output path for scaffold-plugin (default: <root>/leflect/plugins/<name>-plugin.ts)");
  output.text("  --yes                Accept detected defaults for init");
  output.text("  --force              Overwrite an existing config during init");
  output.text("  --auto-system-classpath  Enable system classpath discovery");
  output.text("  --system-classpath-roots <p> Search roots for auto classpath discovery");
  output.text("  --system-classpath-max-retries <n> Retry count for auto classpath augmentation");
  output.text("  --ignore-file <path> Ignore rules file (.gitignore syntax)");
  output.text("  --jsp-ast-mode <m>   JSP AST mode override: jasper | lightweight");
  output.text("  --worker-jar <path>  Worker JAR path to write during init");
  output.text("  --jre-home <path>    JRE home to write during init");
  output.text("  --java-home <path>   JAVA_HOME to write during init");
  output.text("  --java-classpath <p> Extra Java classpath entries (path separator list)");
  output.text("  --jsp-classpath <p>  Extra JSP classpath entries (path separator list)");
  output.text("  --java-maven-command <cmd>  Maven command for Java classpath discovery");
  output.text("  --jsp-maven-command <cmd>   Maven command for JSP classpath discovery");
  output.text("  --jsp-webapp-root <path>    JSP webapp root to write during init");
  output.text("  --entry-java <regexes>      Comma-separated Java entry file regexes");
  output.text("  --entry-jsp <regexes>       Comma-separated JSP entry file regexes");
  output.text("  --labels-out <path>  Label output path (default: analysisOut/index/labels.json)");
  output.text("  --host <value>       Host for dashboard-server/dashboard-dev (default: 127.0.0.1)");
  output.text("  --port <value>       API port for dashboard-server/dashboard-dev (default: 3000)");
  output.text("  --dev-port <value>   Frontend port for dashboard-dev (default: 4173)");
  output.text("  --mode <value>       dashboard-server mode: development | production");
  output.text("  --dashboard-app <path> Dashboard app directory override");
  output.text("  --file <path>        Target JSP path for query jsp-impact");
  output.text("  --class <name>       Target Java/tag handler class for queries");
  output.text("  --format <type>      Output format for analyze/query: text | json");
  output.text("  --incremental        Use cache state and process only changed files");
  output.text("  --quiet              Suppress progress output for scan/build/analyze commands");
  output.text("  -h, --help           Show help");
  output.text("  -v, --version        Show version");
}

async function loadCliConfig(
  parsed: Record<string, string>,
  directOverrides: Partial<{ analysisOut: string; labelsOut: string }> = {}
) {
  return loadExecutionConfig({
    root: parsed["root"] ? path.resolve(parsed["root"]) : process.cwd(),
    configPath: parsed["config"] ? path.resolve(parsed["config"]) : undefined,
    ignoreFile: parsed["ignore-file"] ? path.resolve(parsed["ignore-file"]) : undefined,
    analysisOut:
      directOverrides.analysisOut ??
      (parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined) ??
      (parsed["out"] ? path.resolve(parsed["out"]) : undefined),
    labelsOut:
      directOverrides.labelsOut ??
      (parsed["labels-out"] ? path.resolve(parsed["labels-out"]) : undefined),
    classpathDiscovery: buildClasspathDiscoveryOverride(parsed),
    jspAstMode: resolveJspAstMode(parsed["jsp-ast-mode"])
  });
}

function buildClasspathDiscoveryOverride(
  parsed: Record<string, string>
): LeflectConfig["classpathDiscovery"] | undefined {
  return buildOverrides({
    enabled:
      parsed["auto-system-classpath"] !== undefined
        ? parsed["auto-system-classpath"] === "true"
        : undefined,
    maxRetries: parsed["system-classpath-max-retries"]
      ? Number.parseInt(parsed["system-classpath-max-retries"], 10)
      : undefined,
    searchRoots: parsed["system-classpath-roots"]
      ? parsed["system-classpath-roots"]
          .split(path.delimiter)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined
  });
}

async function loadExecutionConfig(options: {
  root?: string;
  configPath?: string;
  analysisOut?: string;
  ignoreFile?: string;
  labelsOut?: string;
  classpathDiscovery?: LeflectConfig["classpathDiscovery"];
  jspAstMode?: "jasper" | "lightweight";
}): Promise<CliConfig> {
  const { config } = await loadConfig({
    root: options.root,
    configPath: options.configPath,
    overrides: buildOverrides({
      analysisOut: options.analysisOut,
      ignoreFile: options.ignoreFile,
      labelsOut: options.labelsOut,
      classpathDiscovery: options.classpathDiscovery,
      jsp: options.jspAstMode
        ? buildOverrides({ astMode: options.jspAstMode })
        : undefined
    })
  });

  return config;
}

function buildAnalyzeOptionsFromArgs(parsed: Record<string, string>): AnalyzeWorkspaceOptions {
  return {
    root: parsed["root"] ? path.resolve(parsed["root"]) : process.cwd(),
    configPath: parsed["config"] ? path.resolve(parsed["config"]) : undefined,
    analysisOut:
      parsed["out"] ? path.resolve(parsed["out"]) : (
        parsed["analysis"] ? path.resolve(parsed["analysis"]) : undefined
      ),
    ignoreFile: parsed["ignore-file"] ? path.resolve(parsed["ignore-file"]) : undefined,
    labelsOut: parsed["labels-out"] ? path.resolve(parsed["labels-out"]) : undefined,
    incremental: parsed["incremental"] === "true",
    jspAstMode: resolveJspAstMode(parsed["jsp-ast-mode"]),
    classpathDiscovery: buildClasspathDiscoveryOverride(parsed)
  };
}

function resolveConfigFormat(value: string | undefined, configPath: string): ConfigFileFormat {
  if (value && value !== "ts" && value !== "json") {
    throw new Error("Option '--config-format' must be 'json' or 'ts'");
  }
  if (value === "ts") {
    return "ts";
  }
  if (value === "json") {
    return "json";
  }
  return configPath.endsWith(".ts") ? "ts" : "json";
}

function defaultConfigName(format?: string): string {
  return format === "ts" ? "leflect.config.ts" : "leflect.config.json";
}

function resolvePluginTarget(value?: string): "java" | "jsp" | "common" {
  if (!value) {
    return "java";
  }
  if (value === "java" || value === "jsp" || value === "common") {
    return value;
  }
  throw new Error("Option '--target' must be 'java', 'jsp', or 'common'");
}

async function ensureDashboardArtifacts(analysisOut: string): Promise<void> {
  const requiredArtifacts = [
    [path.join(analysisOut, "report", "summary.json")],
    [path.join(analysisOut, "graph", "file-dependencies.json")],
    [path.join(analysisOut, "graph", "file-dependency.jsonl")],
    [path.join(analysisOut, "index", "java-files.json")],
    [path.join(analysisOut, "index", "jsp-files.json")],
    [path.join(analysisOut, "index", "java")],
    [path.join(analysisOut, "index", "jsp")]
  ];

  for (const candidates of requiredArtifacts) {
    let resolved = false;
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      throw new Error(
        `Dashboard requires existing analysis artifacts. Missing one of: ${candidates.join(", ")}. Run 'leflect analyze' first.`
      );
    }
  }
}

async function resolveDashboardAppDir(overridePath?: string): Promise<string | undefined> {
  const candidates = [
    overridePath ? path.resolve(overridePath) : undefined,
    process.env.LEFLECT_DASHBOARD_APP_DIR ? path.resolve(process.env.LEFLECT_DASHBOARD_APP_DIR) : undefined,
    path.resolve(__dirname, "..", "..", "..", "apps", "leflect-java-projection"),
    path.resolve(process.cwd(), "apps", "leflect-java-projection"),
    path.resolve(process.cwd(), "..", "apps", "leflect-java-projection")
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  return undefined;
}
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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
  if (!value || value === "text") {
    return "text";
  }
  if (value === "json") {
    return "json";
  }
  throw new Error("Option '--format' must be 'text' or 'json'");
}

function printResult(
  output: CommandOutput,
  payload: unknown,
  format: OutputFormat,
  textOutput: string
): void {
  if (format === "json") {
    output.json(payload);
    return;
  }

  output.text(textOutput);
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

async function writeRawTaglibIndex(analysisOut: string, taglibs: TldIndex[]): Promise<void> {
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
