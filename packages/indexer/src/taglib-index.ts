import fs from "fs/promises";
import path from "path";

import { TldIndex } from "@lefectjava/parser-tld";

import { JspDocIndexEntry } from "./jsp-index";

export type TaglibIndexSource = TldIndex & {
  sourcePath?: string;
};

export type TaglibTagUsageEntry = {
  name: string;
  handlerClass?: string;
  jspFiles: string[];
};

export type TaglibIndexEntry = {
  uri?: string;
  sourcePath?: string;
  prefixes: string[];
  jspFiles: string[];
  tags: TaglibTagUsageEntry[];
};

export type TaglibIndex = {
  taglibs: TaglibIndexEntry[];
};

export function buildTaglibIndex(
  taglibs: TaglibIndexSource[],
  jspDocs: JspDocIndexEntry[]
): TaglibIndex {
  const map = new Map<string, TaglibIndexEntry>();

  for (const taglib of taglibs) {
    const key = buildKey(taglib.uri, taglib.sourcePath);
    map.set(key, {
      uri: taglib.uri,
      sourcePath: normalizeOptionalPath(taglib.sourcePath),
      prefixes: [],
      jspFiles: [],
      tags: (taglib.tags ?? []).map((tag) => ({
        name: tag.name,
        handlerClass: tag.handlerClass,
        jspFiles: []
      }))
    });
  }

  for (const doc of jspDocs) {
    const normalizedPath = normalizePath(doc.path);
    const resolvedByTag = new Map<string, { uri?: string; handlerClass?: string }>();
    for (const resolved of doc.resolvedTags ?? []) {
      resolvedByTag.set(`${resolved.prefix}:${resolved.name}`, {
        uri: resolved.uri,
        handlerClass: resolved.handlerClass
      });
    }

    for (const directive of doc.taglibs) {
      const key = buildKey(directive.uri);
      const entry = map.get(key) ?? {
        uri: directive.uri,
        prefixes: [],
        jspFiles: [],
        tags: []
      };

      addUnique(entry.prefixes, directive.prefix);
      addUnique(entry.jspFiles, normalizedPath);

      const usedTags = doc.tags.filter((tag) => tag.prefix === directive.prefix);
      for (const tag of usedTags) {
        const resolved = resolvedByTag.get(`${tag.prefix}:${tag.name}`);
        const target = findOrCreateTagEntry(entry.tags, tag.name, resolved?.handlerClass);
        if (!target.handlerClass && resolved?.handlerClass) {
          target.handlerClass = resolved.handlerClass;
        }
        addUnique(target.jspFiles, normalizedPath);
      }

      map.set(key, entry);
    }
  }

  return {
    taglibs: [...map.values()]
      .sort((left, right) => (left.uri ?? left.sourcePath ?? "").localeCompare(right.uri ?? right.sourcePath ?? ""))
      .map((entry) => ({
        ...entry,
        prefixes: [...entry.prefixes].sort(),
        jspFiles: [...entry.jspFiles].sort(),
        tags: [...entry.tags]
          .map((tag) => ({
            ...tag,
            jspFiles: [...tag.jspFiles].sort()
          }))
          .sort((left, right) => left.name.localeCompare(right.name))
      }))
  };
}

export async function writeTaglibIndex(outDir: string, index: TaglibIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "taglibs.json"),
    JSON.stringify(index.taglibs, null, 2)
  );
}

function buildKey(uri?: string, sourcePath?: string): string {
  return uri ?? `path:${normalizeOptionalPath(sourcePath) ?? "unknown"}`;
}

function findOrCreateTagEntry(
  tags: TaglibTagUsageEntry[],
  name: string,
  handlerClass?: string
): TaglibTagUsageEntry {
  const existing = tags.find((tag) => tag.name === name);
  if (existing) {
    return existing;
  }

  const created: TaglibTagUsageEntry = {
    name,
    handlerClass,
    jspFiles: []
  };
  tags.push(created);
  return created;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function normalizeOptionalPath(value?: string): string | undefined {
  return value ? normalizePath(value) : undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
