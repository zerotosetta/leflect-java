import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { CachedFileEntry, FileHashesCache, StageCacheState, StageName } from "@lefectjava/schema";

const CACHE_SCHEMA_VERSION = "1.0";

export type IncrementalPlan = {
  reason: "initial" | "invalidated" | "changed" | "cache-hit";
  selectedFiles: string[];
  removedFiles: string[];
  unchangedFiles: string[];
};

export async function ensureCacheDir(analysisOut: string): Promise<string> {
  const cacheDir = path.join(analysisOut, "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

export function createCacheKey(payload: unknown): string {
  return `sha1:${crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex")}`;
}

export async function readFileHashesCache(filePath: string): Promise<FileHashesCache | undefined> {
  return readOptionalJsonFile<FileHashesCache>(filePath);
}

export async function writeFileHashesCache(
  filePath: string,
  cache: FileHashesCache
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cache, null, 2));
}

export async function readStageCacheState<TEntry = never>(
  filePath: string
): Promise<StageCacheState<TEntry> | undefined> {
  return readOptionalJsonFile<StageCacheState<TEntry>>(filePath);
}

export async function writeStageCacheState<TEntry>(
  filePath: string,
  state: StageCacheState<TEntry>
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

export function buildStageIncrementalPlan(
  currentFiles: string[],
  fileHashes: Record<string, CachedFileEntry>,
  previousState: StageCacheState<unknown> | undefined,
  cacheKey: string
): IncrementalPlan {
  if (!previousState || previousState.cacheKey !== cacheKey) {
    return {
      reason: previousState ? "invalidated" : "initial",
      selectedFiles: [...currentFiles],
      removedFiles: previousState ? Object.keys(previousState.files).filter((file) => !currentFiles.includes(file)) : [],
      unchangedFiles: []
    };
  }

  const selectedFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const file of currentFiles) {
    const currentHash = fileHashes[file]?.hash;
    if (!currentHash || previousState.files[file] !== currentHash) {
      selectedFiles.push(file);
      continue;
    }
    unchangedFiles.push(file);
  }

  const removedFiles = Object.keys(previousState.files).filter((file) => !currentFiles.includes(file));

  if (selectedFiles.length === 0 && removedFiles.length === 0) {
    return {
      reason: "cache-hit",
      selectedFiles,
      removedFiles,
      unchangedFiles
    };
  }

  return {
    reason: "changed",
    selectedFiles,
    removedFiles,
    unchangedFiles
  };
}

export function createStageCacheState<TEntry>(
  stage: StageName,
  cacheKey: string,
  currentFiles: string[],
  fileHashes: Record<string, CachedFileEntry>,
  entries?: Record<string, TEntry>
): StageCacheState<TEntry> {
  const files = Object.fromEntries(
    currentFiles.map((file) => [file, fileHashes[file]?.hash ?? ""])
  );

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    stage,
    generatedAt: new Date().toISOString(),
    cacheKey,
    files,
    entries
  };
}

export async function removeRelativeJsonFiles(
  baseDir: string,
  relativeFiles: string[]
): Promise<void> {
  await Promise.all(
    relativeFiles.map(async (file) => {
      await fs.rm(path.join(baseDir, `${file}.json`), { force: true });
    })
  );
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
