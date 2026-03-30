import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import { spawnSync } from "child_process";
import { findJavaWorkerJar } from "./release-common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPackagePath = path.join(repoRoot, "packages", "cli", "package.json");
const rootReadmePath = path.join(repoRoot, "README.md");
const rootLicensePath = path.join(repoRoot, "LICENSE");
const cliDistEntry = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const cliTypesEntry = path.join(repoRoot, "packages", "cli", "dist", "index.d.ts");
const artifactsDir = path.join(repoRoot, ".artifacts");
const packageDir = path.join(artifactsDir, "npx-cli");
const packDir = path.join(artifactsDir, "packages");

await ensureBuilt(cliDistEntry);
const workerJarPath = await findJavaWorkerJar();

const cliPackage = JSON.parse(await fs.readFile(cliPackagePath, "utf8"));
const publishedPackage = {
  name: "leflect-java",
  version: cliPackage.version,
  description: cliPackage.description,
  license: "MIT",
  bin: {
    leflect: "index.js"
  },
  type: "commonjs",
  files: [
    "index.js",
    "index.d.ts",
    "README.md",
    "LICENSE",
    "java"
  ]
};

await fs.rm(packageDir, { recursive: true, force: true });
await fs.mkdir(packageDir, { recursive: true });
await fs.mkdir(packDir, { recursive: true });

await build({
  entryPoints: [cliDistEntry],
  outfile: path.join(packageDir, "index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  legalComments: "none"
});

await fs.copyFile(cliTypesEntry, path.join(packageDir, "index.d.ts"));
await fs.copyFile(rootReadmePath, path.join(packageDir, "README.md"));
await fs.copyFile(rootLicensePath, path.join(packageDir, "LICENSE"));
await copyOptionalWorkerJar();
await fs.writeFile(
  path.join(packageDir, "package.json"),
  JSON.stringify(publishedPackage, null, 2) + "\n",
  "utf8"
);

const packResult = spawnSync("npm", ["pack", packageDir, "--pack-destination", packDir], {
  cwd: repoRoot,
  encoding: "utf8"
});

if (packResult.status !== 0) {
  process.stderr.write(packResult.stderr || packResult.stdout);
  process.exit(packResult.status ?? 1);
}

const tarball = packResult.stdout.trim().split(/\s+/).pop();
const tarballPath = path.join(packDir, tarball);
console.log(`NPX CLI package ready: ${tarballPath}`);
console.log(`Run with: npx --yes --package file:${tarballPath} leflect --help`);

async function ensureBuilt(entryPath) {
  try {
    await fs.access(entryPath);
  } catch {
    throw new Error(`CLI build not found at ${entryPath}. Run 'pnpm build' first.`);
  }
}

async function copyOptionalWorkerJar() {
  if (!workerJarPath) {
    console.warn("Warning: Java worker JAR not found in java-worker/target. NPX package will run lightweight-only unless a worker JAR is provided externally.");
    return;
  }

  const javaDir = path.join(packageDir, "java");
  await fs.mkdir(javaDir, { recursive: true });
  const workerJarName = path.basename(workerJarPath);
  await fs.copyFile(workerJarPath, path.join(javaDir, workerJarName));
  await fs.writeFile(path.join(javaDir, "worker-jar.json"), JSON.stringify({ fileName: workerJarName }, null, 2) + "\n", "utf8");
}
