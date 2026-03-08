import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import {
  artifactsRoot,
  copyDir,
  discoverWorkspacePackages,
  findJavaWorkerJar,
  readJson,
  repoRoot,
  resetDir,
  resolveVersionMap,
  rewriteWorkspaceManifest,
  rootPackageJsonPath,
  rootReadmePath,
  slugifyPackageName,
  topologicallySortPackages,
  writeJson
} from "./release-common.mjs";

const [, , action = "prepare", ...argv] = process.argv;
const args = parseArgs(argv);
const shouldPublish = action === "publish";
const releaseVersion = String(args.get("version") || (await readJson(rootPackageJsonPath)).version);
const releaseRoot = path.resolve(String(args.get("output-root") || path.join(artifactsRoot, "release")));
const stageRoot = path.join(releaseRoot, "stage");
const packRoot = path.join(releaseRoot, "packages");
const includeBinary = !args.has("no-binary");
const tag = String(args.get("tag") || "latest");
const skipChecks = args.has("skip-checks");
const skipExisting = !args.has("publish-existing");
const dryRun = args.has("dry-run") || !shouldPublish;

if (!skipChecks) {
  runOrThrow("pnpm", ["release:check"], { cwd: repoRoot, stdio: "inherit" });
}

const workerJar = await findJavaWorkerJar();
if (!workerJar) {
  throw new Error("Java worker JAR not found in java-worker/target. Build the worker before preparing a release.");
}

const workspacePackages = topologicallySortPackages(await discoverWorkspacePackages());
const versionMap = resolveVersionMap(workspacePackages, releaseVersion, releaseVersion);

await resetDir(releaseRoot);
await fs.mkdir(stageRoot, { recursive: true });
await fs.mkdir(packRoot, { recursive: true });

const preparedPackages = [];
for (const pkg of workspacePackages) {
  const stageDir = path.join(stageRoot, slugifyPackageName(pkg.name));
  await stageWorkspacePackage(pkg, stageDir, versionMap, workerJar);
  const tarball = packPackage(stageDir, packRoot);
  preparedPackages.push({
    name: pkg.name,
    version: versionMap.get(pkg.name),
    stageDir,
    tarball,
    binary: false
  });
}

if (includeBinary) {
  const binarySummary = buildBinaryPackage(releaseVersion, releaseRoot);
  const tarball = packPackage(binarySummary.packageDir, packRoot);
  preparedPackages.push({
    name: binarySummary.packageName,
    version: binarySummary.version,
    stageDir: binarySummary.packageDir,
    tarball,
    binary: true,
    platform: binarySummary.platform,
    arch: binarySummary.arch,
    executable: binarySummary.binaryOutputPath
  });
}

const releaseManifest = {
  generatedAt: new Date().toISOString(),
  releaseVersion,
  tag,
  packages: preparedPackages
};
await writeJson(path.join(releaseRoot, "release-manifest.json"), releaseManifest);

for (const pkg of preparedPackages) {
  if (dryRun) {
    continue;
  }

  if (skipExisting && isAlreadyPublished(pkg.name, pkg.version)) {
    console.log(`Skipping already published package ${pkg.name}@${pkg.version}`);
    continue;
  }

  const publishArgs = ["publish", pkg.stageDir, "--access", "public", "--tag", tag];
  if (args.has("otp")) {
    publishArgs.push("--otp", String(args.get("otp")));
  }
  runOrThrow("npm", publishArgs, { cwd: repoRoot, stdio: "inherit" });
}

if (args.has("json")) {
  process.stdout.write(JSON.stringify(releaseManifest));
} else {
  console.log(`Release manifest ready: ${path.join(releaseRoot, "release-manifest.json")}`);
  console.log(dryRun ? "Dry-run only. Packages were packed but not published." : "Publish completed.");
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

async function stageWorkspacePackage(pkg, stageDir, versionMap, workerJarPath) {
  const manifest = rewriteWorkspaceManifest(pkg.manifest, versionMap, {
    version: versionMap.get(pkg.name),
    includeJavaWorkerJar: pkg.name === "@leflect-java/cli"
  });

  await resetDir(stageDir);
  await copyDir(path.join(pkg.directory, "dist"), path.join(stageDir, "dist"));
  await fs.copyFile(rootReadmePath, path.join(stageDir, "README.md"));
  if (pkg.name === "@leflect-java/cli") {
    await fs.mkdir(path.join(stageDir, "java"), { recursive: true });
    const workerJarName = path.basename(workerJarPath);
    await fs.copyFile(workerJarPath, path.join(stageDir, "java", workerJarName));
    await writeJson(path.join(stageDir, "java", "worker-jar.json"), { fileName: workerJarName });
  }
  await writeJson(path.join(stageDir, "package.json"), manifest);
}

function buildBinaryPackage(version, releaseRootDir) {
  const result = runOrThrow(
    "node",
    [path.join(repoRoot, "scripts", "build-binary-package.mjs"), "--version", version, "--output-root", path.join(releaseRootDir, "binary"), "--json"],
    { cwd: repoRoot, captureStdout: true }
  );
  return JSON.parse(result.stdout.trim());
}

function packPackage(stageDir, packDir) {
  const result = runOrThrow("npm", ["pack", stageDir, "--pack-destination", packDir], {
    cwd: repoRoot,
    captureStdout: true
  });
  const tarballName = result.stdout.trim().split(/\s+/).pop();
  return path.join(packDir, tarballName);
}

function isAlreadyPublished(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result.status === 0;
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }
  if (options.captureStdout) {
    return result;
  }
  return result;
}
