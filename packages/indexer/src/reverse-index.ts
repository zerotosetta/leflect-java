import fs from "fs/promises";
import path from "path";

import { ResolvedTag } from "@leflect-java/parser-jsp";

import { CallIndexEntry, ClassIndexEntry } from "./java-index";
import { JspDocIndexEntry } from "./jsp-index";

export type ReverseIndex = {
  handlerToJsp: Record<string, string[]>;
  taglibUriToJsp: Record<string, string[]>;
  tagToJsp: Record<string, string[]>;
  classToFiles: Record<string, string[]>;
  fileToClasses: Record<string, string[]>;
  classCallers: Record<string, string[]>;
};

export type ReverseIndexInput = {
  resolvedTags: Array<ResolvedTag & { jspPath: string }>;
  jspDocs?: JspDocIndexEntry[];
  classes?: ClassIndexEntry[];
  calls?: CallIndexEntry[];
};

export function buildReverseIndex(input: ReverseIndexInput): ReverseIndex {
  const handlerToJsp = toSortedRecord(groupBy(input.resolvedTags, (tag) => tag.handlerClass, (tag) => tag.jspPath));
  const taglibUriToJsp = toSortedRecord(
    groupBy(
      (input.jspDocs ?? []).flatMap((doc) =>
        doc.taglibs.map((taglib) => ({ uri: taglib.uri, path: doc.path }))
      ),
      (entry) => entry.uri,
      (entry) => entry.path
    )
  );
  const tagToJsp = toSortedRecord(
    groupBy(
      (input.jspDocs ?? []).flatMap((doc) =>
        doc.tags.map((tag) => ({ key: `${tag.prefix}:${tag.name}`, path: doc.path }))
      ),
      (entry) => entry.key,
      (entry) => entry.path
    )
  );
  const classToFiles = toSortedRecord(
    groupBy(input.classes ?? [], (entry) => entry.id, (entry) => entry.file)
  );
  const fileToClasses = toSortedRecord(
    groupBy(input.classes ?? [], (entry) => entry.file, (entry) => entry.id)
  );
  const classCallers = toSortedRecord(
    groupBy(
      (input.calls ?? []).filter((entry) => Boolean(entry.toClassId)),
      (entry) => entry.toClassId,
      (entry) => entry.fromClassId ?? entry.fromFile ?? entry.from ?? ""
    )
  );

  return {
    handlerToJsp,
    taglibUriToJsp,
    tagToJsp,
    classToFiles,
    fileToClasses,
    classCallers
  };
}

export async function writeReverseIndex(outDir: string, index: ReverseIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "reverse-index.json"),
    JSON.stringify(index, null, 2)
  );
}

function groupBy<T>(
  items: T[],
  keySelector: (item: T) => string | undefined,
  valueSelector: (item: T) => string
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const item of items) {
    const key = keySelector(item);
    const value = valueSelector(item);
    if (!key || !value) {
      continue;
    }
    const values = result.get(key) ?? new Set<string>();
    values.add(normalizePath(value));
    result.set(key, values);
  }

  return result;
}

function toSortedRecord(source: Map<string, Set<string>>): Record<string, string[]> {
  return Object.fromEntries(
    [...source.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, values]) => [key, [...values].sort()])
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
