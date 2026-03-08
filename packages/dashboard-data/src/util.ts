import fs from "fs/promises";
import path from "path";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function statSignature(paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      parts.push(`${filePath}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${filePath}:missing`);
    }
  }
  return parts.join("|");
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const source = normalized
    .split("**")
    .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

export function matchesAnyPattern(value: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

export function takeTop<T>(entries: T[], limit: number): T[] {
  return entries.slice(0, Math.max(limit, 0));
}

export function simpleName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizePath(value);
  if (normalized.endsWith(".java") || normalized.endsWith(".jsp")) {
    return path.basename(normalized);
  }
  const parts = normalized.split(/[./]/g).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function unique<T>(entries: T[]): T[] {
  return [...new Set(entries)];
}

export function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function shallowClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
