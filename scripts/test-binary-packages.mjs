import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import {
  artifactsRoot,
  createBinaryPackageName,
  defaultBinaryTargets,
  parseBinaryTargets,
  repoRoot,
  serializeBinaryTarget
} from "./release-common.mjs";

const args = parseArgs(process.argv.slice(2));
const targets = parseBinaryTargets(args.get("targets")) ?? defaultBinaryTargets();
const outputRoot = path.resolve(String(args.get("output-root") || path.join(artifactsRoot, "binary-matrix")));

for (const target of targets) {
  const targetKey = serializeBinaryTarget(target.platform, target.arch);
  const targetRoot = path.join(outputRoot, targetKey);
  const packageDir = path.join(targetRoot, "npm-package");
  const binaryPath = path.join(targetRoot, "dist", target.platform === "win32" ? "leflect.exe" : "leflect");
  const packageJsonPath = path.join(packageDir, "package.json");

  const manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const stat = await fs.stat(binaryPath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`Invalid binary output for ${targetKey}: ${binaryPath}`);
  }

  const expectedName = createBinaryPackageName(target.platform, target.arch);
  if (manifest.name !== expectedName) {
    throw new Error(`Unexpected package name for ${targetKey}: ${manifest.name}`);
  }
  if (!Array.isArray(manifest.os) || manifest.os[0] !== target.platform) {
    throw new Error(`Unexpected os metadata for ${targetKey}`);
  }
  if (!Array.isArray(manifest.cpu) || manifest.cpu[0] !== target.arch) {
    throw new Error(`Unexpected cpu metadata for ${targetKey}`);
  }

  if (target.platform === process.platform && target.arch === process.arch) {
    const nativeTest = spawnSync("node", [path.join("scripts", "test-binary-package.mjs"), "--binary", binaryPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if (nativeTest.status !== 0) {
      process.stderr.write(nativeTest.stderr || nativeTest.stdout || "");
      process.exit(nativeTest.status ?? 1);
    }
  }

  console.log(`Binary package verified: ${expectedName}`);
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
