import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");
export const packagesRoot = path.join(repoRoot, "packages");
export const artifactsRoot = path.join(repoRoot, ".artifacts");
export const rootReadmePath = path.join(repoRoot, "README.md");
export const rootPackageJsonPath = path.join(repoRoot, "package.json");
export const cliPackagePath = path.join(packagesRoot, "cli", "package.json");
export const cliDistEntry = path.join(packagesRoot, "cli", "dist", "index.js");
export const cliTypesEntry = path.join(packagesRoot, "cli", "dist", "index.d.ts");

const JAVA_WORKER_JAR_PATTERN = /^leflectjava-java-worker-.*\.jar$/;

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function ensureFile(targetPath, message) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(message ?? `Missing required file: ${targetPath}`);
  }
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function resetDir(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

export async function copyDir(sourceDir, destinationDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(destinationDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, destinationPath);
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

export async function discoverWorkspacePackages() {
  const entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(packagesRoot, entry.name);
    const packageJsonPath = path.join(directory, "package.json");
    try {
      await fs.access(packageJsonPath);
    } catch {
      continue;
    }

    const manifest = await readJson(packageJsonPath);
    packages.push({
      directory,
      packageJsonPath,
      manifest,
      name: manifest.name,
      version: manifest.version
    });
  }

  packages.sort((left, right) => left.name.localeCompare(right.name));
  return packages;
}

export function rewriteWorkspaceManifest(manifest, versions, options = {}) {
  const next = JSON.parse(JSON.stringify(manifest));
  const version = options.version ?? versions.get(next.name) ?? next.version;
  next.version = version;
  delete next.private;
  next.publishConfig = {
    ...(next.publishConfig ?? {}),
    access: "public"
  };

  for (const dependencyField of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
    const dependencies = next[dependencyField];
    if (!dependencies) {
      continue;
    }

    const rewritten = {};
    for (const [name, range] of Object.entries(dependencies)) {
      rewritten[name] = rewriteDependencyRange(String(range), versions.get(name));
    }
    next[dependencyField] = rewritten;
  }

  if (options.includeJavaWorkerJar) {
    const files = new Set(next.files ?? []);
    files.add("java");
    files.add("README.md");
    next.files = Array.from(files);
  }

  return next;
}

function rewriteDependencyRange(range, version) {
  if (!range.startsWith("workspace:")) {
    return range;
  }

  if (!version) {
    throw new Error(`Unable to resolve workspace dependency version for range '${range}'`);
  }

  const suffix = range.slice("workspace:".length);
  if (suffix === "" || suffix === "*") {
    return version;
  }
  if (suffix === "^") {
    return `^${version}`;
  }
  if (suffix === "~") {
    return `~${version}`;
  }
  if (suffix.startsWith("^") || suffix.startsWith("~")) {
    return `${suffix[0]}${version}`;
  }
  return suffix;
}

export function resolveVersionMap(packages, overrideVersion, rootVersion) {
  const versions = new Map();
  for (const pkg of packages) {
    versions.set(pkg.name, overrideVersion ?? pkg.version ?? rootVersion);
  }
  return versions;
}

export async function findJavaWorkerJar() {
  const targetDir = path.join(repoRoot, "java-worker", "target");
  let entries = [];
  try {
    entries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && JAVA_WORKER_JAR_PATTERN.test(entry.name) && !entry.name.startsWith("original-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const selected = candidates[0];
  return selected ? path.join(targetDir, selected) : undefined;
}

export function slugifyPackageName(name) {
  return name.replace(/^@/, "").replace(/[\/]/g, "-");
}

export function resolvePkgPlatform(platform) {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "win";
    default:
      return platform;
  }
}

export function topologicallySortPackages(packages) {
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visited = new Set();
  const visiting = new Set();
  const result = [];

  for (const pkg of packages) {
    visit(pkg);
  }

  return result;

  function visit(pkg) {
    if (visited.has(pkg.name)) {
      return;
    }
    if (visiting.has(pkg.name)) {
      throw new Error(`Circular workspace dependency detected at ${pkg.name}`);
    }

    visiting.add(pkg.name);
    const dependencies = {
      ...(pkg.manifest.dependencies ?? {}),
      ...(pkg.manifest.peerDependencies ?? {}),
      ...(pkg.manifest.optionalDependencies ?? {})
    };

    for (const dependencyName of Object.keys(dependencies)) {
      const dependency = packageMap.get(dependencyName);
      if (dependency) {
        visit(dependency);
      }
    }

    visiting.delete(pkg.name);
    visited.add(pkg.name);
    result.push(pkg);
  }
}
