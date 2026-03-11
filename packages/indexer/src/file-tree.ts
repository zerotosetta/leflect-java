import fs from "fs/promises";
import path from "path";

export async function readSourceMetadataTree<T>(rootDir: string): Promise<T[]> {
  const files = await collectJsonFiles(rootDir);
  const entries: T[] = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    entries.push(JSON.parse(raw) as T);
  }

  return entries;
}

export async function writeSourceMetadataTree<T extends { path: string }>(
  rootDir: string,
  entries: T[]
): Promise<Map<string, string>> {
  const metadataPaths = new Map<string, string>();
  const indexDir = path.dirname(rootDir);

  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(rootDir, { recursive: true });

  for (const entry of entries) {
    const target = path.join(rootDir, `${normalizePath(entry.path)}.json`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(entry, null, 2));
    metadataPaths.set(entry.path, normalizePath(path.relative(indexDir, target)));
  }

  return metadataPaths;
}

export async function removeFiles(rootDir: string, fileNames: string[]): Promise<void> {
  await Promise.all(fileNames.map((fileName) => fs.rm(path.join(rootDir, fileName), { force: true })));
}

async function collectJsonFiles(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          return collectJsonFiles(entryPath);
        }
        return entry.name.endsWith(".json") ? [entryPath] : [];
      })
    );

    return files.flat().sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
