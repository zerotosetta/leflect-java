import path from "path";

import { loadConfig } from "@lefectjava/core";
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
    overrides: {
      analysisOut,
      ignoreFile
    }
  });

  await scanWorkspace({
    root: config.root,
    analysisOut: config.analysisOut,
    ignoreFile: config.ignoreFile
  });

  console.log(`Scan complete. Output: ${config.analysisOut}`);
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
  console.log("\nOptions:");
  console.log("  --root <path>        Repository root");
  console.log("  --out <path>         Analysis output directory");
  console.log("  --config <path>      Config file path (default: <root>/leflect.config.json)");
  console.log("  --ignore-file <path> Ignore rules file (.gitignore syntax)");
  console.log("  -h, --help           Show help");
  console.log("  -v, --version        Show version");
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
