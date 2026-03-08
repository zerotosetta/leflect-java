import fs from "fs/promises";
import path from "path";

import {
  EntryDependencyIndex,
  FileDependencyIndex,
  FileDependencyRecord,
  FileDependencyReference,
  GraphConfidence,
  GraphEdge,
  GraphEdgeType,
  GraphNodeType
} from "@lefectjava/schema";

export type JavaCallRecord = {
  from?: string;
  to?: string;
  fromClassId?: string;
  toClassId?: string;
  fromMethodId?: string;
  toMethodId?: string;
  fromFile?: string;
  toFile?: string;
};

export type GraphClassRecord = {
  id: string;
  name: string;
  file?: string;
};

export type GraphResolvedTag = {
  prefix: string;
  name: string;
  handlerClass?: string;
};

export type GraphJspRecord = {
  path: string;
  scriptlets: Array<{ kind: string; code: string }>;
  tags?: Array<{ prefix: string; name: string }>;
  resolvedTags?: GraphResolvedTag[];
};

export type GraphBuildOptions = {
  entryFiles?: {
    java?: string[];
    jsp?: string[];
  };
};

export type GraphBuildResult = {
  javaCallEdges: GraphEdge[];
  jspJavaEdges: GraphEdge[];
  fileEdges: GraphEdge[];
  fileDependencies: FileDependencyIndex;
  entryDependencies: EntryDependencyIndex;
};

const SCHEMA_VERSION = "1.0";

export function buildJavaCallGraph(
  calls: JavaCallRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  const classLookup = buildClassLookup(classes);

  return calls.map((call) => {
    const fromClassId = call.fromClassId ?? extractClassId(call.from);
    const toClassId = call.toClassId ?? extractClassId(call.to);
    const fromClass = fromClassId ? classLookup.get(fromClassId) : undefined;
    const toClass = toClassId ? classLookup.get(toClassId) : undefined;
    const from = fromClass?.id ?? fromClassId ?? call.from ?? "unresolved:java-call:from";
    const to = toClass?.id ?? toClassId ?? call.to ?? "unresolved:java-call:to";

    return {
      from,
      to,
      type: "JAVA_CALL",
      confidence: isResolvedEdge(from, to) ? resolveJavaCallConfidence(call) : "unresolved",
      fromFile: normalizeOptionalPath(call.fromFile ?? fromClass?.file),
      toFile: normalizeOptionalPath(call.toFile ?? toClass?.file),
      fromSymbol: call.fromMethodId ?? call.from,
      toSymbol: call.toMethodId ?? call.to
    };
  });
}

export function buildJspGraph(
  docs: GraphJspRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  const classLookup = buildClassLookup(classes);
  const edges: GraphEdge[] = [];

  for (const doc of docs) {
    const jspPath = normalizePath(doc.path);

    for (const [index, scriptlet] of doc.scriptlets.entries()) {
      const resolvedClass = resolveScriptletClass(scriptlet.code, classLookup);
      edges.push({
        from: jspPath,
        to: resolvedClass?.id ?? `unresolved:scriptlet:${jspPath}:${index}`,
        type: "JSP_SCRIPTLET_CALL",
        confidence: resolvedClass ? "low" : "unresolved",
        fromFile: jspPath,
        toFile: normalizeOptionalPath(resolvedClass?.file),
        toSymbol: resolvedClass?.id
      });
    }

    const resolvedTags = doc.resolvedTags ?? [];
    if (resolvedTags.length > 0) {
      for (const tag of resolvedTags) {
        const resolvedClass = tag.handlerClass ? classLookup.get(tag.handlerClass) : undefined;
        edges.push({
          from: jspPath,
          to: resolvedClass?.id ?? tag.handlerClass ?? `unresolved:tag:${tag.prefix}:${tag.name}`,
          type: "JSP_USES_TAG",
          confidence: tag.handlerClass ? "high" : "unresolved",
          fromFile: jspPath,
          toFile: normalizeOptionalPath(resolvedClass?.file),
          toSymbol: tag.handlerClass
        });
      }
      continue;
    }

    for (const [index, tag] of (doc.tags ?? []).entries()) {
      edges.push({
        from: jspPath,
        to: `unresolved:tag:${tag.prefix}:${tag.name}:${index}`,
        type: "JSP_USES_TAG",
        confidence: "unresolved",
        fromFile: jspPath
      });
    }
  }

  return edges;
}

export function buildGraphs(
  calls: JavaCallRecord[],
  docs: GraphJspRecord[],
  classes: GraphClassRecord[],
  options: GraphBuildOptions = {}
): GraphBuildResult {
  const javaCallEdges = buildJavaCallGraph(calls, classes);
  const jspJavaEdges = buildJspGraph(docs, classes);
  const nodeTypes = buildNodeTypeLookup(classes, docs);
  const fileEdges = buildFileEdges([...javaCallEdges, ...jspJavaEdges], nodeTypes);

  return {
    javaCallEdges,
    jspJavaEdges,
    fileEdges,
    fileDependencies: buildFileDependencyIndex(fileEdges, nodeTypes),
    entryDependencies: buildEntryDependencyIndex(fileEdges, nodeTypes, options.entryFiles)
  };
}

export async function writeGraphFiles(
  analysisOut: string,
  result: GraphBuildResult
): Promise<void> {
  const outDir = path.join(analysisOut, "graph");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "java-call.jsonl"),
    toJsonl(result.javaCallEdges)
  );
  await fs.writeFile(
    path.join(outDir, "jsp-java.jsonl"),
    toJsonl(result.jspJavaEdges)
  );
  await fs.writeFile(
    path.join(outDir, "file-dependency.jsonl"),
    toJsonl(result.fileEdges)
  );
  await fs.writeFile(
    path.join(outDir, "file-dependencies.json"),
    JSON.stringify(result.fileDependencies, null, 2)
  );
  await fs.writeFile(
    path.join(outDir, "entry-dependencies.json"),
    JSON.stringify(result.entryDependencies, null, 2)
  );
}

function resolveJavaCallConfidence(call: JavaCallRecord): GraphConfidence {
  if (call.from && call.to) {
    return "high";
  }
  return "unresolved";
}

function buildClassLookup(classes: GraphClassRecord[]): Map<string, GraphClassRecord> {
  const lookup = new Map<string, GraphClassRecord>();

  for (const entry of classes) {
    lookup.set(entry.id, entry);
    lookup.set(entry.name, entry);

    if (entry.id.includes(".")) {
      lookup.set(entry.id.split(".").at(-1) ?? entry.id, entry);
    }
  }

  return lookup;
}

function resolveScriptletClass(
  code: string,
  classLookup: Map<string, GraphClassRecord>
): GraphClassRecord | undefined {
  const candidates = [...classLookup.entries()].sort((left, right) => right[0].length - left[0].length);
  for (const [candidate, classRecord] of candidates) {
    if (code.includes(candidate)) {
      return classRecord;
    }
  }

  return undefined;
}

function buildNodeTypeLookup(
  classes: GraphClassRecord[],
  docs: GraphJspRecord[]
): Map<string, Exclude<GraphNodeType, "unresolved">> {
  const lookup = new Map<string, Exclude<GraphNodeType, "unresolved">>();

  for (const entry of classes) {
    if (entry.file) {
      lookup.set(normalizePath(entry.file), "java");
    }
  }

  for (const doc of docs) {
    lookup.set(normalizePath(doc.path), "jsp");
  }

  return lookup;
}

function buildFileEdges(
  edges: GraphEdge[],
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): GraphEdge[] {
  return edges
    .flatMap((edge) => {
      const from = normalizeOptionalPath(edge.fromFile) ?? (
        nodeTypes.has(normalizePath(edge.from)) ? normalizePath(edge.from) : undefined
      );
      if (!from) {
        return [];
      }

      const normalizedToFile = normalizeOptionalPath(edge.toFile);
      const normalizedTo = normalizedToFile ??
        (nodeTypes.has(normalizePath(edge.to)) ? normalizePath(edge.to) : normalizePath(edge.to));

      return [{
        ...edge,
        from,
        to: normalizedTo,
        fromFile: from,
        toFile: normalizedToFile ?? (nodeTypes.has(normalizedTo) ? normalizedTo : undefined)
      }];
    })
    .sort(compareEdge);
}

function buildFileDependencyIndex(
  fileEdges: GraphEdge[],
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): FileDependencyIndex {
  const records = new Map<
    string,
    {
      nodeType: Exclude<GraphNodeType, "unresolved">;
      references: Map<string, FileDependencyReference>;
      referencedBy: Map<string, FileDependencyReference>;
    }
  >();

  for (const [file, nodeType] of nodeTypes.entries()) {
    records.set(file, {
      nodeType,
      references: new Map<string, FileDependencyReference>(),
      referencedBy: new Map<string, FileDependencyReference>()
    });
  }

  for (const edge of fileEdges) {
    const source = normalizePath(edge.from);
    const target = normalizePath(edge.to);
    const sourceRecord = records.get(source);
    if (!sourceRecord) {
      continue;
    }

    const targetType = resolveNodeType(target, nodeTypes);
    upsertReference(
      sourceRecord.references,
      target,
      targetType,
      edge.type,
      edge.toSymbol ?? edge.to
    );

    const targetRecord = records.get(target);
    if (targetRecord) {
      upsertReference(
        targetRecord.referencedBy,
        source,
        sourceRecord.nodeType,
        edge.type,
        edge.fromSymbol ?? edge.from
      );
    }
  }

  const files: FileDependencyRecord[] = [...records.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([file, record]) => ({
      path: file,
      nodeType: record.nodeType,
      referenceCount: record.references.size,
      dependantCount: record.referencedBy.size,
      references: sortReferences(record.references),
      referencedBy: sortReferences(record.referencedBy)
    }));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    files
  };
}

function buildEntryDependencyIndex(
  fileEdges: GraphEdge[],
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>,
  entryFiles?: GraphBuildOptions["entryFiles"]
): EntryDependencyIndex {
  const patterns = {
    java: entryFiles?.java ?? [],
    jsp: entryFiles?.jsp ?? []
  };

  if (patterns.java.length === 0 && patterns.jsp.length === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      patterns,
      matchedEntries: [],
      unmatchedPatterns: [],
      entries: []
    };
  }

  const compiled = {
    java: patterns.java.map((pattern) => ({
      pattern,
      expression: compilePattern("java", pattern)
    })),
    jsp: patterns.jsp.map((pattern) => ({
      pattern,
      expression: compilePattern("jsp", pattern)
    }))
  };

  const matchMap = new Map<string, { path: string; nodeType: "java" | "jsp"; matchedBy: string[] }>();
  const unmatchedPatterns = new Set<string>([
    ...patterns.java.map((pattern) => `java:${pattern}`),
    ...patterns.jsp.map((pattern) => `jsp:${pattern}`)
  ]);

  for (const [file, nodeType] of nodeTypes.entries()) {
    const candidates = compiled[nodeType];
    for (const candidate of candidates) {
      if (!candidate.expression.test(file)) {
        continue;
      }

      const entry = matchMap.get(file) ?? { path: file, nodeType, matchedBy: [] };
      entry.matchedBy.push(candidate.pattern);
      matchMap.set(file, entry);
      unmatchedPatterns.delete(`${nodeType}:${candidate.pattern}`);
    }
  }

  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of fileEdges) {
    const edges = adjacency.get(edge.from) ?? [];
    edges.push(edge);
    adjacency.set(edge.from, edges);
  }

  const entries = [...matchMap.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => {
      const visited = new Set<string>([entry.path]);
      const queue = [entry.path];
      const collected = new Map<string, GraphEdge>();

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }

        for (const edge of adjacency.get(current) ?? []) {
          collected.set(edgeSignature(edge), edge);

          if (nodeTypes.has(edge.to) && !visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push(edge.to);
          }
        }
      }

      const edges = [...collected.values()].sort(compareEdge);
      return {
        entry: entry.path,
        nodeType: entry.nodeType,
        matchedBy: [...new Set(entry.matchedBy)].sort(),
        nodeCount: visited.size,
        edgeCount: edges.length,
        reachableFiles: [...visited].sort(),
        edges
      };
    });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    patterns,
    matchedEntries: [...matchMap.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => ({
        path: entry.path,
        nodeType: entry.nodeType,
        matchedBy: [...new Set(entry.matchedBy)].sort()
      })),
    unmatchedPatterns: [...unmatchedPatterns]
      .sort()
      .map((value) => {
        const separator = value.indexOf(":");
        const nodeType = value.slice(0, separator);
        const pattern = value.slice(separator + 1);
        return {
          nodeType: nodeType as "java" | "jsp",
          pattern
        };
      }),
    entries
  };
}

function compilePattern(
  nodeType: "java" | "jsp",
  pattern: string
): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config 'entryFiles.${nodeType}' pattern '${pattern}': ${reason}`);
  }
}

function upsertReference(
  targetMap: Map<string, FileDependencyReference>,
  pathValue: string,
  nodeType: GraphNodeType,
  edgeType: GraphEdgeType,
  symbol: string
): void {
  const current = targetMap.get(pathValue) ?? {
    path: pathValue,
    nodeType,
    edgeTypes: [],
    symbols: []
  };

  if (!current.edgeTypes.includes(edgeType)) {
    current.edgeTypes.push(edgeType);
  }
  if (symbol && !current.symbols.includes(symbol)) {
    current.symbols.push(symbol);
  }

  current.edgeTypes.sort();
  current.symbols.sort();
  targetMap.set(pathValue, current);
}

function sortReferences(source: Map<string, FileDependencyReference>): FileDependencyReference[] {
  return [...source.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function resolveNodeType(
  value: string,
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): GraphNodeType {
  return nodeTypes.get(value) ?? "unresolved";
}

function isResolvedEdge(from: string, to: string): boolean {
  return !from.startsWith("unresolved:") && !to.startsWith("unresolved:");
}

function extractClassId(value?: string): string | undefined {
  if (!value || value.startsWith("unresolved:")) {
    return undefined;
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) {
    return value.slice(0, hashIndex);
  }

  return value.includes(".") ? value : undefined;
}

function edgeSignature(edge: GraphEdge): string {
  return [
    edge.from,
    edge.to,
    edge.type,
    edge.confidence,
    edge.fromSymbol ?? "",
    edge.toSymbol ?? ""
  ].join("|");
}

function compareEdge(left: GraphEdge, right: GraphEdge): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.type.localeCompare(right.type) ||
    (left.fromSymbol ?? "").localeCompare(right.fromSymbol ?? "") ||
    (left.toSymbol ?? "").localeCompare(right.toSymbol ?? "")
  );
}

function normalizeOptionalPath(value?: string): string | undefined {
  return value ? normalizePath(value) : undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toJsonl(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}
