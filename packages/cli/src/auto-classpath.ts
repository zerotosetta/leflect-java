import AdmZip from "adm-zip";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { LeflectConfig } from "@lefectjava/schema";

type ParseProblemRecord = {
  category?: string;
  detail?: string;
  message?: string;
  rawCause?: string;
  relatedUri?: string | null;
};

type DiscoverSystemClasspathEntriesOptions = {
  existingEntries?: string[];
  searchRoots: string[];
  classQueries?: string[];
  taglibUriQueries?: string[];
};

const DEFAULT_SEARCH_ROOTS = [
  path.join(os.homedir(), ".m2", "repository"),
  path.join(os.homedir(), ".gradle", "caches", "modules-2", "files-2.1"),
  path.join(os.homedir(), ".ivy2", "cache"),
  "/usr/share/java"
];

const URI_PATTERN = /absolute uri:\s*\[(.+?)\]\s*cannot be resolved/i;
const MISSING_CLASS_PATTERN =
  /(?:NoClassDefFoundError|ClassNotFoundException):\s*([A-Za-z0-9_/$\.]+)/g;
const COMMON_TOKENS = new Set([
  "com",
  "org",
  "net",
  "io",
  "java",
  "javax",
  "jakarta",
  "http",
  "https",
  "www",
  "class",
  "classes",
  "jsp",
  "servlet",
  "taglib",
  "tags"
]);

export function isSystemClasspathDiscoveryEnabled(config: LeflectConfig): boolean {
  return config.classpathDiscovery?.enabled === true;
}

export function resolveSystemClasspathSearchRoots(config: LeflectConfig): string[] {
  const configured = config.classpathDiscovery?.searchRoots ?? [];
  return configured.length > 0 ? configured : DEFAULT_SEARCH_ROOTS;
}

export function resolveSystemClasspathMaxRetries(config: LeflectConfig): number {
  return config.classpathDiscovery?.maxRetries ?? 3;
}

export async function collectJavaImportQueries(root: string, files: string[]): Promise<string[]> {
  const imports = new Set<string>();

  for (const file of files) {
    const source = path.join(root, file);
    const content = await fs.readFile(source, "utf8");
    const matches = content.matchAll(/^\s*import\s+(static\s+)?([\w$.]+)\s*;/gm);

    for (const match of matches) {
      const isStatic = Boolean(match[1]);
      const symbol = match[2];
      if (!symbol || symbol.endsWith(".*")) {
        continue;
      }

      if (isStatic) {
        const segments = symbol.split(".");
        if (segments.length > 1) {
          imports.add(segments.slice(0, -1).join("."));
        }
        continue;
      }

      imports.add(symbol);
    }
  }

  return [...imports].sort();
}

export async function readParseProblems(filePath: string): Promise<ParseProblemRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ParseProblemRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function extractMissingClassQueries(problems: ParseProblemRecord[]): string[] {
  const classes = new Set<string>();

  for (const problem of problems) {
    const haystack = [problem.message, problem.detail, problem.rawCause].filter(Boolean).join("\n");
    for (const entry of extractMissingClassQueriesFromText(haystack)) {
      classes.add(entry);
    }
  }

  return [...classes].sort();
}

export function extractMissingTaglibUriQueries(problems: ParseProblemRecord[]): string[] {
  const uris = new Set<string>();

  for (const problem of problems) {
    if (problem.relatedUri) {
      uris.add(problem.relatedUri);
      continue;
    }

    const haystack = [problem.message, problem.detail, problem.rawCause].filter(Boolean).join("\n");
    for (const entry of extractMissingTaglibUriQueriesFromText(haystack)) {
      uris.add(entry);
    }
  }

  return [...uris].sort();
}

export function extractMissingClassQueriesFromText(text: string): string[] {
  const classes = new Set<string>();
  for (const match of text.matchAll(MISSING_CLASS_PATTERN)) {
    const rawName = match[1];
    if (!rawName) {
      continue;
    }
    const normalized = normalizeClassQuery(rawName);
    if (normalized) {
      classes.add(normalized);
    }
  }
  return [...classes].sort();
}

export function extractMissingTaglibUriQueriesFromText(text: string): string[] {
  const uris = new Set<string>();
  const match = text.match(URI_PATTERN);
  if (match?.[1]) {
    uris.add(match[1]);
  }
  return [...uris].sort();
}

export async function discoverSystemClasspathEntries(
  options: DiscoverSystemClasspathEntriesOptions
): Promise<string[]> {
  const classTargets = new Set(
    (options.classQueries ?? [])
      .map((query) => normalizeClassQuery(query))
      .filter((query): query is string => Boolean(query))
      .map((query) => `${query.replace(/\./g, "/")}.class`)
  );
  const uriTargets = new Set((options.taglibUriQueries ?? []).filter(Boolean));

  if (classTargets.size === 0 && uriTargets.size === 0) {
    return [];
  }

  const existing = new Set((options.existingEntries ?? []).map((entry) => path.resolve(entry)));
  const jarPaths = await collectJarFiles(options.searchRoots);
  const candidates = selectCandidateJars(jarPaths, [...classTargets], [...uriTargets]);
  const discovered = new Set<string>();

  for (const jarPath of candidates) {
    const resolvedJarPath = path.resolve(jarPath);
    if (existing.has(resolvedJarPath)) {
      continue;
    }

    const matched = await jarMatchesQueries(resolvedJarPath, classTargets, uriTargets);
    if (matched) {
      discovered.add(resolvedJarPath);
    }
  }

  return [...discovered].sort();
}

async function collectJarFiles(searchRoots: string[]): Promise<string[]> {
  const jars = new Set<string>();

  for (const root of searchRoots) {
    const resolvedRoot = path.resolve(root);
    try {
      const stat = await fs.stat(resolvedRoot);
      if (stat.isFile() && resolvedRoot.endsWith(".jar")) {
        jars.add(resolvedRoot);
        continue;
      }
      if (stat.isDirectory()) {
        for (const jar of await walkJarFiles(resolvedRoot)) {
          jars.add(jar);
        }
      }
    } catch {
      continue;
    }
  }

  return [...jars].sort();
}

async function walkJarFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJarFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jar")) {
      files.push(fullPath);
    }
  }

  return files;
}

function selectCandidateJars(jarPaths: string[], classTargets: string[], uriTargets: string[]): string[] {
  if (uriTargets.length > 0) {
    return jarPaths;
  }

  const tokens = buildSearchTokens(classTargets, uriTargets);
  if (tokens.length === 0) {
    return jarPaths;
  }

  const candidates = jarPaths.filter((jarPath) => {
    const lowerPath = jarPath.toLowerCase();
    return tokens.some((token) => lowerPath.includes(token));
  });

  return candidates.length > 0 ? candidates : jarPaths;
}

function buildSearchTokens(classTargets: string[], uriTargets: string[]): string[] {
  const tokens = new Set<string>();

  for (const query of [...classTargets, ...uriTargets]) {
    for (const token of query.split(/[^a-zA-Z0-9]+/)) {
      const normalized = token.toLowerCase();
      if (normalized.length < 4 || COMMON_TOKENS.has(normalized)) {
        continue;
      }
      tokens.add(normalized);
    }
  }

  return [...tokens].sort((left, right) => right.length - left.length);
}

async function jarMatchesQueries(
  jarPath: string,
  classTargets: Set<string>,
  uriTargets: Set<string>
): Promise<boolean> {
  try {
    const zip = new AdmZip(jarPath);
    const entries = zip.getEntries();
    const entryNames = new Set(entries.map((entry) => entry.entryName));

    for (const target of classTargets) {
      if (entryNames.has(target)) {
        return true;
      }
    }

    if (uriTargets.size === 0) {
      return false;
    }

    for (const entry of entries) {
      if (!entry.entryName.endsWith(".tld")) {
        continue;
      }

      const content = entry.getData().toString("utf8");
      for (const uri of uriTargets) {
        if (content.includes(uri)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeClassQuery(value: string): string | undefined {
  const normalized = value.replace(/\.class$/, "").replace(/\//g, ".").trim();
  return normalized.includes(".") ? normalized : undefined;
}
