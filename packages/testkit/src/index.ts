import fs from "fs/promises";
import os from "os";
import path from "path";

export type FixtureWorkspace = {
  fixturePath: string;
  root: string;
  analysisOut: string;
};

export function resolveFixturePath(name: string, baseDir = process.cwd()): string {
  return path.resolve(baseDir, "tests", "fixtures", name);
}

export async function createFixtureWorkspace(
  name: string,
  baseDir = process.cwd()
): Promise<FixtureWorkspace> {
  const fixturePath = resolveFixturePath(name, baseDir);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `leflect-fixture-${name}-`));
  await copyDirectory(fixturePath, root);

  return {
    fixturePath,
    root,
    analysisOut: path.join(root, "analysis")
  };
}

export async function cleanupWorkspace(workspace: FixtureWorkspace): Promise<void> {
  await fs.rm(workspace.root, { recursive: true, force: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}
