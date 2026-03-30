import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";

import { XMLParser } from "fast-xml-parser";

import { TldAttributeSchema, TldRegistryEntry, TldRegistryTag, TldSourceKind } from "@leflect-java/schema";

export type TldTag = TldRegistryTag;

export type TldIndex = {
  uri?: string;
  tags: TldTag[];
};

export type TldRegistryDiagnostic = {
  severity: "warning";
  code: "duplicate-uri" | "invalid-source" | "invalid-jar-entry";
  message: string;
  uri?: string;
  sourcePath?: string;
};

export type LoadTldRegistryOptions = {
  root: string;
  repoFiles?: string[];
  configuredPaths?: string[];
  classpathEntries?: string[];
  autoLoad?: boolean;
  uriMap?: Record<string, string>;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

type CandidateSource = {
  sourcePath: string;
  readPath: string;
  sourceKind: TldSourceKind;
  order: number;
  priority: number;
  overrideUri?: string;
};

export function parseTld(xml: string): TldIndex {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const taglib = (doc["taglib"] ?? doc["tag-lib"]) as Record<string, unknown> | undefined;

  if (!taglib || typeof taglib !== "object") {
    return { tags: [] };
  }

  const uri = typeof taglib["uri"] === "string" ? (taglib["uri"] as string) : undefined;
  const tagsNode = taglib["tag"];
  const tags = normalizeTags(tagsNode);

  return { uri, tags };
}

export async function loadTldRegistry(
  options: LoadTldRegistryOptions
): Promise<{ entries: TldRegistryEntry[]; diagnostics: TldRegistryDiagnostic[] }> {
  const diagnostics: TldRegistryDiagnostic[] = [];
  const candidates = await collectCandidateSources(options, diagnostics);
  const resolved = new Map<string, { entry: TldRegistryEntry; priority: number; order: number }>();
  const anonymousEntries: TldRegistryEntry[] = [];

  for (const candidate of candidates) {
    const xml = await readCandidateContent(candidate).catch(() => undefined);
    if (!xml) {
      diagnostics.push({
        severity: "warning",
        code: candidate.sourcePath.includes("!/")
          ? "invalid-jar-entry"
          : "invalid-source",
        message: `Failed to read TLD source ${candidate.sourcePath}`,
        sourcePath: candidate.sourcePath
      });
      continue;
    }

    const parsed = parseTld(xml);
    const effectiveUri = candidate.overrideUri ?? parsed.uri;
    const entry: TldRegistryEntry = {
      uri: effectiveUri,
      sourcePath: candidate.sourcePath,
      sourceKind: candidate.sourceKind,
      tags: parsed.tags
    };

    if (!effectiveUri) {
      anonymousEntries.push(entry);
      continue;
    }

    const existing = resolved.get(effectiveUri);
    if (!existing) {
      resolved.set(effectiveUri, {
        entry,
        priority: candidate.priority,
        order: candidate.order
      });
      continue;
    }

    const shouldReplace =
      candidate.priority < existing.priority ||
      (candidate.priority === existing.priority && candidate.order < existing.order);
    if (shouldReplace) {
      diagnostics.push({
        severity: "warning",
        code: "duplicate-uri",
        message: `TLD URI ${effectiveUri} was declared multiple times; keeping ${candidate.sourcePath}`,
        uri: effectiveUri,
        sourcePath: candidate.sourcePath
      });
      resolved.set(effectiveUri, {
        entry,
        priority: candidate.priority,
        order: candidate.order
      });
      continue;
    }

    diagnostics.push({
      severity: "warning",
      code: "duplicate-uri",
      message: `TLD URI ${effectiveUri} was declared multiple times; keeping ${existing.entry.sourcePath}`,
      uri: effectiveUri,
      sourcePath: candidate.sourcePath
    });
  }

  const entries = [
    ...[...resolved.values()].map((value) => value.entry),
    ...anonymousEntries
  ].sort((left, right) => `${left.uri ?? ""}:${left.sourcePath ?? ""}`.localeCompare(`${right.uri ?? ""}:${right.sourcePath ?? ""}`));

  return { entries, diagnostics };
}

async function collectCandidateSources(
  options: LoadTldRegistryOptions,
  diagnostics: TldRegistryDiagnostic[]
): Promise<CandidateSource[]> {
  const candidates: CandidateSource[] = [];
  const seen = new Set<string>();
  let order = 0;

  const pushCandidate = (
    sourcePath: string,
    readPath: string,
    sourceKind: TldSourceKind,
    priority: number,
    overrideUri?: string
  ) => {
    const key = `${sourceKind}:${sourcePath}:${overrideUri ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({
      sourcePath: normalizePath(sourcePath),
      readPath: normalizePath(readPath),
      sourceKind,
      priority,
      order,
      overrideUri
    });
    order += 1;
  };

  for (const [uri, target] of Object.entries(options.uriMap ?? {})) {
    const normalizedTarget = normalizeResourcePath(options.root, target);
    if (!looksLikeDirectTldSource(normalizedTarget)) {
      diagnostics.push({
        severity: "warning",
        code: "invalid-source",
        message: `uriMap target ${target} must point to a .tld file or jar entry`,
        uri,
        sourcePath: normalizedTarget
      });
      continue;
    }
    pushCandidate(normalizedTarget, normalizedTarget, "uri-map", 0, uri);
  }

  for (const file of options.repoFiles ?? []) {
    const absolutePath = normalizeResourcePath(options.root, file);
    pushCandidate(normalizePath(file), absolutePath, "repo", 1);
  }

  for (const configuredPath of options.configuredPaths ?? []) {
    const normalizedPath = normalizeResourcePath(options.root, configuredPath);
    for (const sourcePath of await expandTldSourcePaths(normalizedPath)) {
      pushCandidate(sourcePath, sourcePath, "configured-path", 2);
    }
  }

  if (options.autoLoad) {
    for (const classpathEntry of options.classpathEntries ?? []) {
      const normalizedPath = normalizeResourcePath(options.root, classpathEntry);
      for (const sourcePath of await expandTldSourcePaths(normalizedPath, true)) {
        pushCandidate(sourcePath, sourcePath, "classpath", 3);
      }
    }
  }

  return candidates;
}

async function expandTldSourcePaths(target: string, jarOnly = false): Promise<string[]> {
  const archiveSeparator = target.indexOf("!/");
  if (archiveSeparator >= 0) {
    return [target];
  }

  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      if (target.endsWith(".tld")) {
        return [target];
      }
      if (target.endsWith(".jar")) {
        return await listJarTldEntries(target);
      }
      return [];
    }
    if (!stat.isDirectory()) {
      return [];
    }

    const discovered: string[] = [];
    for (const entry of await walkDir(target)) {
      if (entry.endsWith(".tld") && !jarOnly) {
        discovered.push(entry);
      }
      if (entry.endsWith(".jar")) {
        discovered.push(...(await listJarTldEntries(entry)));
      }
    }
    return discovered.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function walkDir(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function listJarTldEntries(jarPath: string): Promise<string[]> {
  try {
    const zip = new AdmZip(jarPath);
    return zip.getEntries()
      .filter((entry) => entry.entryName.endsWith(".tld"))
      .map((entry) => `${normalizePath(jarPath)}!/${entry.entryName}`)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function readCandidateContent(candidate: CandidateSource): Promise<string> {
  const archiveSeparator = candidate.readPath.indexOf("!/");
  if (archiveSeparator < 0) {
    return fs.readFile(candidate.readPath, "utf8");
  }

  const jarPath = candidate.readPath.slice(0, archiveSeparator);
  const entryPath = candidate.readPath.slice(archiveSeparator + 2);
  const zip = new AdmZip(jarPath);
  const entry = zip.getEntry(entryPath);
  if (!entry) {
    throw new Error(`Missing jar entry ${entryPath}`);
  }
  return entry.getData().toString("utf8");
}

function normalizeTags(node: unknown): TldTag[] {
  if (!node) {
    return [];
  }

  const nodes = Array.isArray(node) ? node : [node];

  return nodes
    .map((item): TldTag | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record["name"] === "string" ? (record["name"] as string) : undefined;
      const handlerClass =
        typeof record["tag-class"] === "string" ? (record["tag-class"] as string) : undefined;
      if (!name) {
        return undefined;
      }

      return {
        name,
        handlerClass,
        attributes: normalizeAttributes(record["attribute"]),
        bodyContent: typeof record["body-content"] === "string"
          ? (record["body-content"] as string)
          : undefined,
        dynamicAttributes: toBoolean(record["dynamic-attributes"])
      };
    })
    .filter((tag): tag is TldTag => tag !== undefined);
}

function normalizeAttributes(node: unknown): TldAttributeSchema[] | undefined {
  if (!node) {
    return undefined;
  }

  const items = Array.isArray(node) ? node : [node];
  const attributes = items
    .map((item): TldAttributeSchema | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record["name"] === "string" ? (record["name"] as string) : undefined;
      if (!name) {
        return undefined;
      }
      return {
        name,
        required: toBoolean(record["required"]),
        runtimeExpressionValue: toBoolean(record["rtexprvalue"]),
        type: typeof record["type"] === "string" ? (record["type"] as string) : undefined,
        fragment: toBoolean(record["fragment"])
      };
    })
    .filter((attribute): attribute is TldAttributeSchema => attribute !== undefined);

  return attributes.length > 0 ? attributes : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeResourcePath(root: string, target: string): string {
  const separator = target.indexOf("!/");
  if (separator < 0) {
    return normalizePath(path.isAbsolute(target) ? target : path.resolve(root, target));
  }

  const archivePath = target.slice(0, separator);
  const entryPath = target.slice(separator + 2);
  const normalizedArchive = path.isAbsolute(archivePath)
    ? archivePath
    : path.resolve(root, archivePath);
  return `${normalizePath(normalizedArchive)}!/${entryPath}`;
}

function looksLikeDirectTldSource(value: string): boolean {
  return value.endsWith(".tld") || /\.jar!\/.+\.tld$/.test(value);
}
