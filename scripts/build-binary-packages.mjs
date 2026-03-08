import path from "path";
import { spawnSync } from "child_process";
import {
  artifactsRoot,
  defaultBinaryTargets,
  parseBinaryTargets,
  repoRoot,
  serializeBinaryTarget
} from "./release-common.mjs";

const args = parseArgs(process.argv.slice(2));
const outputRoot = path.resolve(String(args.get("output-root") || path.join(artifactsRoot, "binary-matrix")));
const targets = parseBinaryTargets(args.get("targets")) ?? defaultBinaryTargets();
const versionArg = args.get("version");
const summaries = [];

for (const target of targets) {
  const targetKey = serializeBinaryTarget(target.platform, target.arch);
  const targetOutputRoot = path.join(outputRoot, targetKey);
  const command = [
    path.join("scripts", "build-binary-package.mjs"),
    "--platform",
    target.platform,
    "--arch",
    target.arch,
    "--output-root",
    targetOutputRoot,
    "--json"
  ];

  if (versionArg) {
    command.push("--version", String(versionArg));
  }

  const result = spawnSync("node", command, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }

  summaries.push(JSON.parse(result.stdout.trim()));
}

if (args.has("json")) {
  process.stdout.write(JSON.stringify(summaries));
} else {
  for (const summary of summaries) {
    console.log(`${summary.packageName} -> ${summary.binaryOutputPath}`);
  }
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      parsed.set(key, true);
      continue;
    }
    parsed.set(key, nextToken);
    index += 1;
  }
  return parsed;
}
