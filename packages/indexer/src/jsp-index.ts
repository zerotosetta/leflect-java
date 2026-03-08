import fs from "fs/promises";
import path from "path";

import { JspParseResult, SourceLocation } from "@lefectjava/parser-jsp";

import { MethodCallParameterEntry, MethodIndexEntry } from "./java-index";

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
  importIds: string[];
  includes: string[];
  taglibCount: number;
  tagCount: number;
  scriptletCount: number;
  resolvedTagCount: number;
  ast?: JspParseResult["ast"];
};

export type JspImportIndexEntry = {
  id: string;
  file: string;
  import: string;
  simpleName?: string;
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
  classPath?: string;
  importId?: string;
  kind: "import" | "tag-handler" | "scriptlet";
  location?: SourceLocation;
  snippet?: string;
  uri?: string;
  handlerClass?: string;
};

export type JspMethodCallIndexEntry = {
  file: string;
  methodName: string;
  methodId?: string;
  qualifier?: string;
  classPath?: string;
  importId?: string;
  inputParameters?: MethodCallParameterEntry[];
  responseType?: string;
  location?: SourceLocation;
  snippet?: string;
};

export type JspFileMetadata = JspFileIndexEntry & {
  importEntries: JspImportIndexEntry[];
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

export type JspIndexOptions = {
  javaMethods?: MethodIndexEntry[];
};

type JspImportLookup = {
  byExact: Map<string, string>;
  bySimple: Map<string, string>;
  wildcards: JspImportIndexEntry[];
};

type JspRawMethodCall = {
  file: string;
  methodName: string;
  qualifier?: string;
  argumentExpressions: string[];
  location?: SourceLocation;
  snippet?: string;
};

export function buildJspIndex(entries: JspDocIndexEntry[], options: JspIndexOptions = {}): JspIndex {
  const docs = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  const files: JspFileIndexEntry[] = [];
  const imports: JspImportIndexEntry[] = [];
  const taglibs: JspTaglibUsageIndexEntry[] = [];
  const tags: JspTagUsageIndexEntry[] = [];
  const scriptlets: JspScriptletIndexEntry[] = [];
  const classReferences: JspClassReferenceIndexEntry[] = [];
  const methodCalls: JspMethodCallIndexEntry[] = [];
  const methodsByClassAndName = groupMethodsByClassAndName(options.javaMethods ?? []);

  for (const entry of docs) {
    const normalizedPath = normalizePath(entry.path);
    const resolvedByTag = new Map<string, JspResolvedTag>();
    for (const resolved of entry.resolvedTags ?? []) {
      resolvedByTag.set(`${resolved.prefix}:${resolved.name}`, resolved);
    }

    const fileImportEntries: JspImportIndexEntry[] = [];
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
        const importEntry: JspImportIndexEntry = {
          id: buildImportId(normalizedPath, normalizedImport),
          file: normalizedPath,
          import: normalizedImport,
          simpleName: extractSimpleName(normalizedImport),
          location
        };
        fileImportEntries.push(importEntry);
        imports.push(importEntry);
        classReferences.push({
          file: normalizedPath,
          className: normalizedImport,
          classPath: normalizedImport,
          importId: importEntry.id,
          kind: "import",
          location,
          snippet: normalizedImport
        });
      }
    }
    const importLookup = createImportLookup(fileImportEntries);
    const fileClassReferences: JspClassReferenceIndexEntry[] = [];
    const rawMethodCalls: JspRawMethodCall[] = [];

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
        const classReference: JspClassReferenceIndexEntry = {
          file: normalizedPath,
          className: resolved.handlerClass,
          classPath: resolved.handlerClass,
          importId: resolveImportId(importLookup, resolved.handlerClass, extractSimpleName(resolved.handlerClass)),
          kind: "tag-handler",
          location: tag.location,
          snippet: tag.raw,
          uri: resolved.uri,
          handlerClass: resolved.handlerClass
        };
        classReferences.push(classReference);
        fileClassReferences.push(classReference);
      }
    }

    for (const scriptlet of entry.scriptlets) {
      scriptlets.push({
        file: normalizedPath,
        kind: scriptlet.kind,
        code: scriptlet.code,
        location: scriptlet.location
      });

      const scriptletClassReferences = extractScriptletClassReferences(normalizedPath, scriptlet).map((reference) => {
        const classPath = resolveClassPath(reference.className, importLookup) ?? reference.className;
        return {
          ...reference,
          classPath,
          importId: resolveImportId(importLookup, classPath, reference.className)
        };
      });
      classReferences.push(...scriptletClassReferences);
      fileClassReferences.push(...scriptletClassReferences);

      rawMethodCalls.push(...extractScriptletMethodCalls(normalizedPath, scriptlet));
    }

    for (const call of rawMethodCalls) {
      const classPath = resolveMethodClassPath(call, fileClassReferences, importLookup);
      const method = resolveMethodEntry(
        methodsByClassAndName,
        classPath,
        call.methodName,
        call.argumentExpressions.length
      );
      methodCalls.push({
        file: call.file,
        methodName: call.methodName,
        methodId: method?.id,
        qualifier: call.qualifier,
        classPath: classPath ?? method?.classId,
        importId: resolveImportId(importLookup, classPath ?? method?.classId, extractSimpleName(classPath ?? call.qualifier)),
        inputParameters: buildMethodCallParameters(method?.parameters, call.argumentExpressions),
        responseType: method?.returnType,
        location: call.location,
        snippet: call.snippet
      });
    }

    files.push({
      path: normalizedPath,
      imports: [...(entry.imports ?? [])].sort(),
      importIds: fileImportEntries.map((item) => item.id),
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
  classReferences.sort((left, right) => `${left.file}:${left.classPath ?? left.className}:${serializeLocation(left.location)}`.localeCompare(`${right.file}:${right.classPath ?? right.className}:${serializeLocation(right.location)}`));
  methodCalls.sort((left, right) => `${left.file}:${left.classPath ?? ""}:${left.methodName}:${serializeLocation(left.location)}`.localeCompare(`${right.file}:${right.classPath ?? ""}:${right.methodName}:${serializeLocation(right.location)}`));

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
    importEntries: index.imports.filter((item) => item.file === entry.path),
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

function extractScriptletMethodCalls(file: string, scriptlet: JspDocIndexEntry["scriptlets"][number]): JspRawMethodCall[] {
  const results: JspRawMethodCall[] = [];
  const regex = /(?:([A-Za-z_][A-Za-z0-9_$.]*)\s*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g;
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
      argumentExpressions: splitArguments(match[3]),
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

function resolveMethodClassPath(
  call: JspRawMethodCall,
  classReferences: JspClassReferenceIndexEntry[],
  lookup: JspImportLookup
): string | undefined {
  if (call.qualifier) {
    const qualifierClassPath = resolveClassPath(call.qualifier, lookup);
    if (qualifierClassPath) {
      return qualifierClassPath;
    }
    if (call.qualifier.includes(".")) {
      return call.qualifier;
    }
  }

  const reference = classReferences
    .filter((item) => item.kind === "scriptlet" && item.location?.line === call.location?.line)
    .filter((item) => (item.location?.column ?? 0) <= (call.location?.column ?? Number.MAX_SAFE_INTEGER))
    .sort((left, right) => (right.location?.column ?? 0) - (left.location?.column ?? 0))
    .at(0);

  return reference?.classPath;
}

function groupMethodsByClassAndName(methods: MethodIndexEntry[]): Map<string, MethodIndexEntry[]> {
  const grouped = new Map<string, MethodIndexEntry[]>();

  for (const method of methods) {
    if (!method.classId) {
      continue;
    }
    const key = `${method.classId}#${method.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), method]);
  }

  return grouped;
}

function resolveMethodEntry(
  methodsByClassAndName: Map<string, MethodIndexEntry[]>,
  classPath: string | undefined,
  methodName: string,
  argumentCount: number
): MethodIndexEntry | undefined {
  if (!classPath) {
    return undefined;
  }
  const candidates = methodsByClassAndName.get(`${classPath}#${methodName}`) ?? [];
  if (candidates.length === 0) {
    return undefined;
  }
  const arityMatches = candidates.filter((candidate) => (candidate.parameters?.length ?? 0) === argumentCount);
  return arityMatches.length === 1 ? arityMatches[0] : undefined;
}

function buildMethodCallParameters(
  parameterTypes?: string[],
  argumentExpressions?: string[]
): MethodCallParameterEntry[] | undefined {
  const size = Math.max(parameterTypes?.length ?? 0, argumentExpressions?.length ?? 0);
  if (size === 0) {
    return undefined;
  }

  return Array.from({ length: size }, (_, index) => ({
    index,
    type: parameterTypes?.[index],
    value: argumentExpressions?.[index]
  }));
}

function createImportLookup(entries: JspImportIndexEntry[]): JspImportLookup {
  const byExact = new Map<string, string>();
  const bySimple = new Map<string, string>();
  const wildcards: JspImportIndexEntry[] = [];

  for (const entry of entries) {
    byExact.set(entry.import, entry.id);
    if (entry.import.endsWith(".*")) {
      wildcards.push(entry);
      continue;
    }
    if (entry.simpleName) {
      bySimple.set(entry.simpleName, entry.id);
    }
  }

  return { byExact, bySimple, wildcards };
}

function resolveImportId(
  lookup: JspImportLookup,
  classPath?: string,
  symbol?: string
): string | undefined {
  if (classPath && lookup.byExact.has(classPath)) {
    return lookup.byExact.get(classPath);
  }

  const simpleName = extractSimpleName(classPath ?? symbol);
  if (simpleName && lookup.bySimple.has(simpleName)) {
    return lookup.bySimple.get(simpleName);
  }

  if (classPath) {
    for (const wildcard of lookup.wildcards) {
      const prefix = wildcard.import.slice(0, -2);
      if (classPath.startsWith(`${prefix}.`)) {
        return wildcard.id;
      }
    }
  }

  return undefined;
}

function resolveClassPath(symbol: string | undefined, lookup: JspImportLookup): string | undefined {
  if (!symbol) {
    return undefined;
  }
  if (symbol.includes(".")) {
    return symbol;
  }

  const importId = lookup.bySimple.get(symbol);
  if (!importId) {
    return undefined;
  }

  for (const [qualifiedImport, id] of lookup.byExact.entries()) {
    if (id === importId && !qualifiedImport.endsWith(".*")) {
      return qualifiedImport;
    }
  }

  return undefined;
}

function buildImportId(file: string, value: string): string {
  return `jsp-import:${file}:${value}`;
}

function extractSimpleName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.endsWith(".*") ? value.slice(0, -2) : value;
  const segments = normalized.split(".");
  return segments.at(-1);
}

function splitArguments(rawArguments: string): string[] {
  const trimmed = rawArguments.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
