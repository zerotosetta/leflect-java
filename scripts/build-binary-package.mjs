import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import { build } from "esbuild";
import {
  artifactsRoot,
  cliDistEntry,
  createBinaryPackageName,
  findJavaWorkerJar,
  readJson,
  repoRoot,
  resetDir,
  resolvePkgPlatform,
  rootLicensePath,
  rootPackageJsonPath,
  rootReadmePath,
  writeJson
} from "./release-common.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith("--")) {
    continue;
  }
  const key = token.slice(2);
  const nextToken = process.argv[index + 1];
  if (!nextToken || nextToken.startsWith("--")) {
    args.set(key, true);
    continue;
  }
  args.set(key, nextToken);
  index += 1;
}

const rootPackage = await readJson(rootPackageJsonPath);
const version = String(args.get("version") || rootPackage.version);
const nodeTarget = String(args.get("node-target") || "node18");
const platform = String(args.get("platform") || process.platform);
const arch = String(args.get("arch") || process.arch);
const pkgTarget = String(args.get("pkg-target") || `${nodeTarget}-${resolvePkgPlatform(platform)}-${arch}`);
const outputRoot = path.resolve(String(args.get("output-root") || path.join(artifactsRoot, "binary")));
const workDir = path.join(outputRoot, "work");
const binaryDir = path.join(outputRoot, "dist");
const packageDir = path.join(outputRoot, "npm-package");
const binaryFileName = platform === "win32" ? "leflect.exe" : "leflect";
const binaryOutputPath = path.join(binaryDir, binaryFileName);
const binaryPackageName = createBinaryPackageName(platform, arch);

await fs.access(cliDistEntry).catch(() => {
  throw new Error(`CLI build not found at ${cliDistEntry}. Run 'pnpm build' first.`);
});

const workerJarPath = await findJavaWorkerJar();
if (!workerJarPath) {
  throw new Error("Java worker JAR not found in java-worker/target. Build the worker before creating the binary package.");
}

await resetDir(outputRoot);
await fs.mkdir(workDir, { recursive: true });
await fs.mkdir(binaryDir, { recursive: true });

await build({
  entryPoints: [cliDistEntry],
  outfile: path.join(workDir, "index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: nodeTarget,
  sourcemap: false,
  legalComments: "none"
});

await fs.mkdir(path.join(workDir, "java"), { recursive: true });
const workerJarName = path.basename(workerJarPath);
await fs.copyFile(workerJarPath, path.join(workDir, "java", workerJarName));
await writeJson(path.join(workDir, "java", "worker-jar.json"), { fileName: workerJarName });
await fs.copyFile(rootReadmePath, path.join(workDir, "README.md"));
await fs.copyFile(rootLicensePath, path.join(workDir, "LICENSE"));

await writeJson(path.join(workDir, "package.json"), {
  name: binaryPackageName,
  version,
  private: true,
  description: "Standalone LeflectJava CLI binary",
  bin: "index.js",
  license: "MIT",
  pkg: {
    assets: ["java/*.jar", "java/worker-jar.json"]
  }
});

const pkgResult = spawnSync("pnpm", ["exec", "pkg", "package.json", "--targets", pkgTarget, "--output", binaryOutputPath], {
  cwd: workDir,
  encoding: "utf8"
});

if (pkgResult.status !== 0) {
  process.stderr.write(pkgResult.stderr || pkgResult.stdout);
  process.exit(pkgResult.status ?? 1);
}

await resetDir(packageDir);
await fs.mkdir(path.join(packageDir, "bin"), { recursive: true });
await fs.copyFile(binaryOutputPath, path.join(packageDir, "bin", binaryFileName));
if (platform !== "win32") {
  await fs.chmod(path.join(packageDir, "bin", binaryFileName), 0o755);
}
await fs.copyFile(rootReadmePath, path.join(packageDir, "README.md"));
await fs.copyFile(rootLicensePath, path.join(packageDir, "LICENSE"));

await writeJson(path.join(packageDir, "package.json"), {
  name: binaryPackageName,
  version,
  description: "Standalone LeflectJava CLI binary with bundled java-worker",
  license: "MIT",
  os: [platform],
  cpu: [arch],
  publishConfig: {
    access: "public"
  },
  bin: {
    leflect: `bin/${binaryFileName}`
  },
  files: [
    "bin",
    "README.md",
    "LICENSE"
  ]
});

const summary = {
  packageName: binaryPackageName,
  version,
  platform,
  arch,
  pkgTarget,
  binaryOutputPath,
  packageDir,
  workerJar: workerJarPath
};

if (args.has("json")) {
  process.stdout.write(JSON.stringify(summary));
} else {
  console.log(`Binary package ready: ${packageDir}`);
  console.log(`Binary executable: ${binaryOutputPath}`);
  console.log(`Publishable package: ${binaryPackageName}@${version}`);
}
