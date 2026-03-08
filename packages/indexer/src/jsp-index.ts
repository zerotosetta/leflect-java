import fs from "fs/promises";
import path from "path";

import { JspParseResult, SourceLocation } from "@lefectjava/parser-jsp";

export type JspResolvedTag = {
  prefix: string;
  name: string;
  uri?: string;
  handlerClass?: string;
};

export type JspDocIndexEntry = JspParseResult & {
  path: string;
  resolvedTags?: JspResolvedTag[];
};

export type JspFileIndexEntry = {
  path: string;
  imports: string[];
  includes: string[];
  taglibCount: number;
  tagCount: number;
  scriptletCount: number;
  resolvedTagCount: number;
  ast?: JspParseResult["ast"];
};

export type JspImportIndexEntry = {
  file: string;
  import: string;
  location?: SourceLocation;
};

export type JspTaglibUsageIndexEntry = {
  file: string;
  prefix: string;
  uri: string;
  location?: SourceLocation;
};

export type JspTagUsageIndexEntry = {
  file: string;
  prefix: string;
  name: string;
  raw: string;
  uri?: string;
  handlerClass?: string;
  location?: SourceLocation;
};

export type JspScriptletIndexEntry = {
  file: string;
  kind: "scriptlet" | "expression" | "declaration";
  code: string;
  location?: SourceLocation;
};

export type JspClassReferenceIndexEntry = {
  file: string;
  className: string;
  kind: "import" | "tag-handler" | "scriptlet";
  location?: SourceLocation;
  snippet?: string;
  uri?: string;
  handlerClass?: string;
};

export type JspMethodCallIndexEntry = {
  file: string;
  methodName: string;
  qualifier?: string;
  location?: SourceLocation;
  snippet?: string;
};

export type JspFileMetadata = JspFileIndexEntry & {
  taglibs: JspTaglibUsageIndexEntry[];
  tags: JspTagUsageIndexEntry[];
  scriptlets: JspScriptletIndexEntry[];
  classReferences: JspClassReferenceIndexEntry[];
  methodCalls: JspMethodCallIndexEntry[];
};

export type JspIndex = {
  docs: JspDocIndexEntry[];
  files: JspFileIndexEntry[];
  imports: JspImportIndexEntry[];
  taglibs: JspTaglibUsageIndexEntry[];
  tags: JspTagUsageIndexEntry[];
  scriptlets: JspScriptletIndexEntry[];
  classReferences: JspClassReferenceIndexEntry[];
  methodCalls: JspMethodCallIndexEntry[];
};

export function buildJspIndex(entries: JspDocIndexEntry[]): JspIndex {
  const docs = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  const files: JspFileIndexEntry[] = [];
  const imports: JspImportIndexEntry[] = [];
  const taglibs: JspTaglibUsageIndexEntry[] = [];
  const tags: JspTagUsageIndexEntry[] = [];
  const scriptlets: JspScriptletIndexEntry[] = [];
  const classReferences: JspClassReferenceIndexEntry[] = [];
  const methodCalls: JspMethodCallIndexEntry[] = [];

  for (const entry of docs) {
    const normalizedPath = normalizePath(entry.path);
    const resolvedByTag = new Map<string, JspResolvedTag>();
    for (const resolved of entry.resolvedTags ?? []) {
      resolvedByTag.set(`${resolved.prefix}:${resolved.name}`, resolved);
    }

    for (const directive of entry.directives ?? []) {
      if (directive.kind !== "page") {
        continue;
      }
      const importValue = directive.attributes["import"];
      if (!importValue) {
        continue;
      }
      for (const item of importValue.split(",")) {
        const normalizedImport = item.trim();
        if (!normalizedImport) {
          continue;
        }
        const location = locateWithinDirective(directive, normalizedImport);
        imports.push({ file: normalizedPath, import: normalizedImport, location });
        classReferences.push({
          file: normalizedPath,
          className: normalizedImport,
          kind: "import",
          location,
          snippet: normalizedImport
        });
      }
    }

    for (const taglib of entry.taglibs) {
      taglibs.push({
        file: normalizedPath,
        prefix: taglib.prefix,
        uri: taglib.uri,
        location: taglib.location
      });
    }

    for (const tag of entry.tags) {
      const resolved = resolvedByTag.get(`${tag.prefix}:${tag.name}`);
      tags.push({
        file: normalizedPath,
        prefix: tag.prefix,
        name: tag.name,
        raw: tag.raw,
        uri: resolved?.uri,
        handlerClass: resolved?.handlerClass,
        location: tag.location
      });
      if (resolved?.handlerClass) {
        classReferences.push({
          file: normalizedPath,
          className: resolved.handlerClass,
          kind: "tag-handler",
          location: tag.location,
          snippet: tag.raw,
          uri: resolved.uri,
          handlerClass: resolved.handlerClass
        });
      }
    }

    for (const scriptlet of entry.scriptlets) {
      scriptlets.push({
        file: normalizedPath,
        kind: scriptlet.kind,
        code: scriptlet.code,
        location: scriptlet.location
      });

      classReferences.push(...extractScriptletClassReferences(normalizedPath, scriptlet));
      methodCalls.push(...extractScriptletMethodCalls(normalizedPath, scriptlet));
    }

    files.push({
      path: normalizedPath,
      imports: [...(entry.imports ?? [])].sort(),
      includes: [...(entry.includes ?? [])].sort(),
      taglibCount: entry.taglibs.length,
      tagCount: entry.tags.length,
      scriptletCount: entry.scriptlets.length,
      resolvedTagCount: (entry.resolvedTags ?? []).filter((tag) => Boolean(tag.handlerClass)).length,
      ast: entry.ast
    });
  }

  imports.sort((left, right) => `${left.file}:${left.import}`.localeCompare(`${right.file}:${right.import}`));
  taglibs.sort((left, right) => `${left.file}:${left.prefix}:${left.uri}`.localeCompare(`${right.file}:${right.prefix}:${right.uri}`));
  tags.sort((left, right) => `${left.file}:${left.prefix}:${left.name}`.localeCompare(`${right.file}:${right.prefix}:${right.name}`));
  scriptlets.sort((left, right) => `${left.file}:${left.kind}:${left.code}`.localeCompare(`${right.file}:${right.kind}:${right.code}`));
  classReferences.sort((left, right) => `${left.file}:${left.className}:${serializeLocation(left.location)}`.localeCompare(`${right.file}:${right.className}:${serializeLocation(right.location)}`));
  methodCalls.sort((left, right) => `${left.file}:${left.methodName}:${serializeLocation(left.location)}`.localeCompare(`${right.file}:${right.methodName}:${serializeLocation(right.location)}`));

  return { docs, files, imports, taglibs, tags, scriptlets, classReferences, methodCalls };
}

export async function writeJspIndex(outDir: string, index: JspIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "jsp-docs.json"), JSON.stringify(index.docs, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-files.json"), JSON.stringify(index.files, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-imports.json"), JSON.stringify(index.imports, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-taglibs.json"), JSON.stringify(index.taglibs, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-tags.json"), JSON.stringify(index.tags, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-scriptlets.json"), JSON.stringify(index.scriptlets, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-class-references.json"), JSON.stringify(index.classReferences, null, 2));
  await fs.writeFile(path.join(outDir, "jsp-method-calls.json"), JSON.stringify(index.methodCalls, null, 2));

  await writePerFileMetadata(path.join(outDir, "jsp"), toJspFileMetadata(index));
}

function toJspFileMetadata(index: JspIndex): JspFileMetadata[] {
  return index.files.map((entry) => ({
    ...entry,
    taglibs: index.taglibs.filter((item) => item.file === entry.path),
    tags: index.tags.filter((item) => item.file === entry.path),
    scriptlets: index.scriptlets.filter((item) => item.file === entry.path),
    classReferences: index.classReferences.filter((item) => item.file === entry.path),
    methodCalls: index.methodCalls.filter((item) => item.file === entry.path)
  }));
}

async function writePerFileMetadata(outDir: string, files: JspFileMetadata[]): Promise<void> {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const entry of files) {
    const target = path.join(outDir, `${entry.path}.json`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(entry, null, 2));
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function locateWithinDirective(directive: JspDocIndexEntry["directives"][number], value: string): SourceLocation | undefined {
  const index = directive.raw.indexOf(value);
  if (index < 0) {
    return directive.location;
  }
  const line = directive.location.line;
  const column = directive.location.column + index;
  return {
    line,
    column,
    endLine: line,
    endColumn: column + value.length - 1
  };
}

function extractScriptletClassReferences(file: string, scriptlet: JspDocIndexEntry["scriptlets"][number]): JspClassReferenceIndexEntry[] {
  const results: JspClassReferenceIndexEntry[] = [];
  const regex = /\bnew\s+([A-Z][A-Za-z0-9_$.]*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(scriptlet.code)) !== null) {
    const className = match[1];
    const classOffset = match.index + match[0].indexOf(className);
    results.push({
      file,
      className,
      kind: "scriptlet",
      location: offsetToLocation(scriptlet, classOffset, className.length),
      snippet: match[0].trim()
    });
  }

  return results;
}

function extractScriptletMethodCalls(file: string, scriptlet: JspDocIndexEntry["scriptlets"][number]): JspMethodCallIndexEntry[] {
  const results: JspMethodCallIndexEntry[] = [];
  const regex = /(?:([A-Za-z_][A-Za-z0-9_$.]*)\s*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const skip = new Set(["if", "for", "while", "switch", "catch", "return", "new"]);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(scriptlet.code)) !== null) {
    const qualifier = match[1];
    const methodName = match[2];
    if (skip.has(methodName)) {
      continue;
    }
    if (!qualifier && looksLikeConstructor(scriptlet.code, match.index, methodName)) {
      continue;
    }

    const nameOffset = match.index + match[0].lastIndexOf(methodName);
    results.push({
      file,
      methodName,
      qualifier,
      location: offsetToLocation(scriptlet, nameOffset, methodName.length),
      snippet: match[0].trim()
    });
  }

  return results;
}

function looksLikeConstructor(code: string, index: number, methodName: string): boolean {
  const prefix = code.slice(Math.max(0, index - 5), index);
  return /\bnew\s*$/.test(prefix) && /^[A-Z]/.test(methodName);
}

function offsetToLocation(
  scriptlet: JspDocIndexEntry["scriptlets"][number],
  relativeOffset: number,
  length: number
): SourceLocation | undefined {
  const slice = scriptlet.code.slice(0, relativeOffset);
  const lines = slice.split("\n");
  const lineOffset = lines.length - 1;
  const columnOffset = lines.at(-1)?.length ?? 0;
  const line = (scriptlet.location?.line ?? 1) + lineOffset;
  const column = lineOffset === 0
    ? (scriptlet.location?.column ?? 1) + columnOffset
    : 1 + columnOffset;
  return {
    line,
    column,
    endLine: line,
    endColumn: column + Math.max(0, length - 1)
  };
}

function serializeLocation(location?: SourceLocation): string {
  if (!location) {
    return "";
  }
  return [location.line, location.column, location.endLine, location.endColumn].join(":");
}
