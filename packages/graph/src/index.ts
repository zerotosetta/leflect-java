import fs from "fs/promises";
import path from "path";

import {
  DeclaredEntryDependencyRecord,
  DeclaredEntrySeedRecord,
  EntryDependencyIndex,
  FileDependencyIndex,
  FileDependencyRecord,
  FileDependencyReference,
  GraphConfidence,
  GraphEdge,
  GraphEdgeType,
  GraphNodeType,
  JspIncludeReference,
  JspFunctionReference,
  JspReferenceLocation,
  LeflectEntryDefinition
} from "@leflect-java/schema";

export type JavaCallRecord = {
  from?: string;
  to?: string;
  fromClassId?: string;
  toClassId?: string;
  fromMethodId?: string;
  callerKind?: "static-initializer";
  invocationKind?: "super-constructor" | "this-constructor";
  toMethodId?: string;
  resolvedMethodId?: string;
  fromFile?: string;
  toFile?: string;
  location?: Partial<JspReferenceLocation>;
};

export type GraphClassRecord = {
  id: string;
  name: string;
  file?: string;
};

export type GraphResolvedTag = {
  prefix: string;
  name: string;
  uri?: string;
  handlerClass?: string;
  tagFile?: string;
  unresolvedReason?: string;
  location?: JspReferenceLocation;
};

export type GraphJspRecord = {
  path: string;
  sourceKind?: "jsp" | "jspf" | "tag" | "tagx";
  scriptlets: Array<{ kind: string; code: string }>;
  tags?: Array<{ prefix: string; name: string; location?: JspReferenceLocation }>;
  resolvedTags?: GraphResolvedTag[];
  includeReferences?: JspIncludeReference[];
  functionCalls?: JspFunctionReference[];
};

export type GraphJavaClassReferenceRecord = {
  file: string;
  className: string;
  qualifiedName?: string;
  classPath?: string;
  kind?: string;
  snippet?: string;
};

export type GraphBuildOptions = {
  entryFiles?: {
    java?: string[];
    jsp?: string[];
  };
  entries?: LeflectEntryDefinition[];
  javaClassReferences?: GraphJavaClassReferenceRecord[];
};

export type GraphBuildResult = {
  javaCallEdges: GraphEdge[];
  javaImportEdges: GraphEdge[];
  javaTypeReferenceEdges: GraphEdge[];
  javaNewEdges: GraphEdge[];
  jspJavaEdges: GraphEdge[];
  fileEdges: GraphEdge[];
  fileDependencies: FileDependencyIndex;
  entryDependencies: EntryDependencyIndex;
};

const SCHEMA_VERSION = "1.0";
const STANDARD_TAGLIB_URIS = new Set([
  "http://java.sun.com/jsp/jstl/core",
  "http://java.sun.com/jsp/jstl/fmt",
  "http://java.sun.com/jsp/jstl/functions",
  "http://java.sun.com/jsp/jstl/sql",
  "http://java.sun.com/jsp/jstl/xml",
  "http://xmlns.jcp.org/jsp/jstl/core",
  "http://xmlns.jcp.org/jsp/jstl/fmt",
  "http://xmlns.jcp.org/jsp/jstl/functions",
  "http://xmlns.jcp.org/jsp/jstl/sql",
  "http://xmlns.jcp.org/jsp/jstl/xml",
  "jakarta.tags.core",
  "jakarta.tags.fmt",
  "jakarta.tags.functions",
  "jakarta.tags.sql",
  "jakarta.tags.xml"
]);

const STANDARD_JSTL_PREFIXES = new Set(["c", "fmt", "fn", "sql", "x"]);

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
      type: call.invocationKind ? "JAVA_CONSTRUCTOR_CALL" : "JAVA_CALL",
      confidence: isResolvedEdge(from, to) ? resolveJavaCallConfidence(call) : "unresolved",
      fromFile: normalizeOptionalPath(call.fromFile ?? fromClass?.file),
      toFile: normalizeOptionalPath(call.toFile ?? toClass?.file),
      fromSymbol: call.callerKind === "static-initializer" && fromClassId
        ? `${fromClassId}#<clinit>()`
        : call.fromMethodId ?? call.from,
      toSymbol: call.toMethodId ?? call.to,
      fromLocation: call.location
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
    for (const call of doc.functionCalls ?? []) {
      if (call.validation === "excluded") continue;
      const resolved = (call.validation === "source" || call.validation === "classpath") && call.className && call.methodId;
      edges.push({
        from: jspPath,
        to: resolved ? call.className! :
          `unresolved:jsp-function:${jspPath}:${call.location.line}:${call.location.column}:${call.prefix}:${call.name}`,
        type: "JSP_FUNCTION_CALL",
        confidence: resolved ? "high" : "unresolved",
        fromFile: jspPath,
        toFile: resolved ? call.targetFile : undefined,
        fromSymbol: `${call.prefix}:${call.name}`,
        toSymbol: resolved ? call.methodId : undefined,
        fromLocation: call.location,
        unresolvedReason: call.unresolvedReason
      });
    }
    for (const include of doc.includeReferences ?? []) {
      const targets = include.targetPath ? [include.targetPath] : include.candidatePaths ?? [];
      if (targets.length === 0 && include.kind === "static") {
        edges.push({
          from: jspPath,
          to: `unresolved:jsp-include:${include.page}`,
          type: "JSP_INCLUDES",
          confidence: "unresolved",
          fromFile: jspPath,
          fromLocation: include.location,
          fromSymbol: include.mode,
          unresolvedReason: include.unresolvedReason
        });
      }
      for (const target of targets) {
        edges.push({
          from: jspPath,
          to: target,
          type: "JSP_INCLUDES",
          confidence: include.kind === "static" ? "high" : "medium",
          fromFile: jspPath,
          toFile: target,
          fromLocation: include.location,
          fromSymbol: include.mode
        });
      }
    }

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
        if (isJspStandardAction(tag) || (!tag.tagFile && isStandardTagReference(tag.prefix, tag.uri, tag.handlerClass))) {
          continue;
        }
        const resolvedClass = tag.handlerClass ? classLookup.get(tag.handlerClass) : undefined;
        edges.push({
          from: jspPath,
          to: tag.tagFile ?? resolvedClass?.id ?? tag.handlerClass ?? `unresolved:tag:${tag.prefix}:${tag.name}`,
          type: tag.tagFile ? "JSP_USES_TAG_FILE" : "JSP_USES_TAG",
          confidence: tag.handlerClass || tag.tagFile ? "high" : "unresolved",
          fromFile: jspPath,
          toFile: normalizeOptionalPath(tag.tagFile ?? resolvedClass?.file),
          fromSymbol: tag.location ? `${tag.prefix}:${tag.name}` : undefined,
          toSymbol: tag.handlerClass,
          fromLocation: tag.location,
          unresolvedReason: tag.unresolvedReason
        });
      }
      continue;
    }

    for (const [index, tag] of (doc.tags ?? []).entries()) {
      if (isJspStandardAction(tag) || isStandardTagReference(tag.prefix)) {
        continue;
      }
      edges.push({
        from: jspPath,
        to: `unresolved:tag:${tag.prefix}:${tag.name}:${index}`,
        type: "JSP_USES_TAG",
        confidence: "unresolved",
        fromFile: jspPath,
        fromLocation: tag.location
      });
    }
  }

  return edges;
}

export function buildJavaImportGraph(
  references: GraphJavaClassReferenceRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  return buildJavaReferenceGraph(references, classes, "import");
}

export function buildJavaTypeReferenceGraph(
  references: GraphJavaClassReferenceRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  return buildJavaReferenceGraph(references, classes, "type");
}

export function buildJavaNewGraph(
  references: GraphJavaClassReferenceRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  return buildJavaReferenceGraph(references, classes, "new");
}

function buildJavaReferenceGraph(
  references: GraphJavaClassReferenceRecord[],
  classes: GraphClassRecord[],
  category: "import" | "type" | "new"
): GraphEdge[] {
  const classLookup = buildClassLookup(classes);
  const edges = new Map<string, GraphEdge>();

  for (const reference of references) {
    if (!matchesJavaReferenceCategory(reference.kind, category)) {
      continue;
    }

    const sourceFile = normalizeOptionalPath(reference.file);
    const target = resolveJavaReferenceTarget(reference, classLookup);

    if (!sourceFile || !target || sourceFile === target.file) {
      continue;
    }

    const edge: GraphEdge = {
      from: sourceFile,
      to: target.id,
      type: javaReferenceEdgeType(category),
      confidence: target.confidence,
      fromFile: sourceFile,
      toFile: target.file,
      fromSymbol: reference.snippet ?? sourceFile,
      toSymbol: target.symbol
    };
    edges.set(edgeSignature(edge), edge);
  }

  return [...edges.values()].sort(compareEdge);
}

export function buildGraphs(
  calls: JavaCallRecord[],
  docs: GraphJspRecord[],
  classes: GraphClassRecord[],
  options: GraphBuildOptions = {}
): GraphBuildResult {
  const javaCallEdges = buildJavaCallGraph(calls, classes);
  const javaImportEdges = buildJavaImportGraph(options.javaClassReferences ?? [], classes);
  const javaTypeReferenceEdges = buildJavaTypeReferenceGraph(options.javaClassReferences ?? [], classes);
  const javaNewEdges = buildJavaNewGraph(options.javaClassReferences ?? [], classes);
  const jspJavaEdges = buildJspGraph(docs, classes);
  const nodeTypes = buildNodeTypeLookup(classes, docs);
  const fileEdges = buildFileEdges(
    [...javaCallEdges, ...javaImportEdges, ...javaTypeReferenceEdges, ...javaNewEdges, ...jspJavaEdges],
    nodeTypes
  );

  return {
    javaCallEdges,
    javaImportEdges,
    javaTypeReferenceEdges,
    javaNewEdges,
    jspJavaEdges,
    fileEdges,
    fileDependencies: buildFileDependencyIndex(fileEdges, nodeTypes),
    entryDependencies: buildEntryDependencyIndex(
      fileEdges,
      nodeTypes,
      options.entryFiles,
      options.entries
    )
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
    path.join(outDir, "java-import.jsonl"),
    toJsonl(result.javaImportEdges)
  );
  await fs.writeFile(
    path.join(outDir, "java-type-reference.jsonl"),
    toJsonl(result.javaTypeReferenceEdges)
  );
  await fs.writeFile(
    path.join(outDir, "java-new.jsonl"),
    toJsonl(result.javaNewEdges)
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
  if (call.invocationKind) {
    return call.fromClassId && call.resolvedMethodId && call.toClassId ? "high" : "unresolved";
  }
  if (call.callerKind === "static-initializer") {
    return call.fromClassId && call.resolvedMethodId && call.toClassId ? "high" : "unresolved";
  }
  if (call.from && call.to) {
    return "high";
  }
  return "unresolved";
}

function buildClassLookup(classes: GraphClassRecord[]): Map<string, GraphClassRecord> {
  const lookup = new Map<string, GraphClassRecord>();
  const ambiguous = new Set<string>();

  for (const entry of classes) {
    lookup.set(entry.id, entry);
    const aliases = new Set([entry.name, entry.id.split(".").at(-1) ?? entry.id]);
    for (const alias of aliases) {
      if (alias === entry.id || ambiguous.has(alias)) {
        continue;
      }
      const previous = lookup.get(alias);
      if (previous && previous.id !== entry.id) {
        lookup.delete(alias);
        ambiguous.add(alias);
      } else {
        lookup.set(alias, entry);
      }
    }
  }

  return lookup;
}

function matchesJavaReferenceCategory(
  kind: string | undefined,
  category: "import" | "type" | "new"
): boolean {
  if (category === "import") {
    return kind === "import";
  }
  if (category === "new") {
    return kind === "new";
  }
  return kind === "type" || kind === "extends" || kind === "implements" || kind === "catch" || kind === "static-qualifier";
}

function javaReferenceEdgeType(category: "import" | "type" | "new"): GraphEdgeType {
  if (category === "import") {
    return "JAVA_IMPORT";
  }
  if (category === "new") {
    return "JAVA_NEW";
  }
  return "JAVA_TYPE_REFERENCE";
}

function resolveJavaReferenceTarget(
  reference: GraphJavaClassReferenceRecord,
  classLookup: Map<string, GraphClassRecord>
): { id: string; file?: string; symbol: string; confidence: GraphConfidence } | undefined {
  const candidates = [
    normalizeReferenceTargetId(reference.classPath),
    normalizeReferenceTargetId(reference.qualifiedName),
    normalizeReferenceTargetId(reference.className)
  ].filter((value): value is string => Boolean(value));
  const qualifiedCandidates = candidates.filter((candidate) => candidate.includes("."));
  const targetClass = (qualifiedCandidates.length ? qualifiedCandidates : candidates)
    .map((candidate) => classLookup.get(candidate))
    .find((candidate): candidate is GraphClassRecord => candidate !== undefined);
  const targetId = targetClass?.id ?? candidates[0];

  if (!targetId || !isLikelyTypeReferenceId(targetId)) {
    return undefined;
  }

  return {
    id: targetId,
    file: normalizeOptionalPath(targetClass?.file),
    symbol: targetClass?.id ?? targetId,
    confidence: targetClass || reference.classPath || reference.qualifiedName ? "high" : "low"
  };
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

function isStandardTaglibUri(uri?: string): boolean {
  if (!uri) {
    return false;
  }

  return STANDARD_TAGLIB_URIS.has(uri.trim());
}

function isStandardTagReference(prefix?: string, uri?: string, handlerClass?: string): boolean {
  if (handlerClass) {
    return false;
  }
  if (isStandardTaglibUri(uri)) {
    return true;
  }
  if (!prefix || uri) {
    return false;
  }

  return STANDARD_JSTL_PREFIXES.has(prefix);
}

function isJspStandardAction(tag: { prefix: string; name: string }): boolean {
  return tag.prefix === "jsp" && ["include", "param", "useBean"].includes(tag.name);
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
    for (const tag of doc.resolvedTags ?? []) {
      if (tag.tagFile) {
        lookup.set(normalizePath(tag.tagFile), "jsp");
      }
    }
    for (const include of doc.includeReferences ?? []) {
      for (const target of include.targetPath ? [include.targetPath] : include.candidatePaths ?? []) {
        const targetPath = normalizePath(target);
        if (!lookup.has(targetPath)) {
          lookup.set(targetPath, "jsp");
        }
      }
    }
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

    const targetType = nodeTypes.get(target) ?? (
      edge.confidence === "high" && !target.startsWith("unresolved:") &&
      /^(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*(?:#.*)?$/.test(target)
        ? "external" : "unresolved"
    );
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
  entryFiles?: GraphBuildOptions["entryFiles"],
  declaredEntries?: LeflectEntryDefinition[]
): EntryDependencyIndex {
  const patterns = {
    java: entryFiles?.java ?? [],
    jsp: entryFiles?.jsp ?? []
  };
  const adjacency = buildAdjacency(fileEdges);

  if (patterns.java.length === 0 && patterns.jsp.length === 0 && (declaredEntries?.length ?? 0) === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      patterns,
      matchedEntries: [],
      unmatchedPatterns: [],
      entries: [],
      declaredEntries: []
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
    if (nodeType !== "java" && nodeType !== "jsp") {
      continue;
    }
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

  const entries = [...matchMap.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => {
      const traversal = traverseFromSeeds([entry.path], adjacency, nodeTypes);
      const edges = [...traversal.edges.values()].sort(compareEdge);
      return {
        entry: entry.path,
        nodeType: entry.nodeType,
        matchedBy: [...new Set(entry.matchedBy)].sort(),
        nodeCount: traversal.visited.size,
        edgeCount: edges.length,
        reachableFiles: [...traversal.visited].sort(),
        edges
      };
    });

  const expandedEntries = expandDeclaredEntries(declaredEntries ?? []);
  const declaredEntryRecords = expandedEntries
    .map((entry) => buildDeclaredEntryRecord(entry, adjacency, nodeTypes))
    .sort((left, right) => {
      const baseDelta = left.id.localeCompare(right.id);
      if (baseDelta !== 0) {
        return baseDelta;
      }
      return (left.variantOf ?? "").localeCompare(right.variantOf ?? "");
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
    entries,
    declaredEntries: declaredEntryRecords
  };
}

function buildDeclaredEntryRecord(
  entry: LeflectEntryDefinition & { variantOf?: string },
  adjacency: Map<string, GraphEdge[]>,
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): DeclaredEntryDependencyRecord {
  const javaSeeds = buildDeclaredSeeds(entry.java ?? [], "java", nodeTypes);
  const jspSeeds = buildDeclaredSeeds(entry.jsp ?? [], "jsp", nodeTypes);
  const traversableSeeds = [...javaSeeds, ...jspSeeds]
    .filter((seed): seed is DeclaredEntrySeedRecord & { path: string } => Boolean(seed.path))
    .map((seed) => seed.path);
  const traversal = traverseFromSeeds(traversableSeeds, adjacency, nodeTypes);
  const deferredTargets = [
    ...(entry.query ?? []).map((value) => ({
      targetType: "query" as const,
      value,
      reason: "graph-model-pending" as const
    })),
    ...(entry.interfaceSpecs ?? []).map((value) => ({
      targetType: "interface" as const,
      value,
      reason: "graph-model-pending" as const
    }))
  ];

  return {
    id: entry.id,
    type: entry.type,
    label: entry.label,
    description: entry.description,
    tags: entry.tags,
    variantOf: entry.variantOf,
    http: entry.http,
    seeds: {
      java: javaSeeds,
      jsp: jspSeeds
    },
    deferredTargets,
    nodeCount: traversal.visited.size,
    edgeCount: traversal.edges.size,
    reachableFiles: [...traversal.visited].sort(),
    edges: [...traversal.edges.values()].sort(compareEdge)
  };
}

function buildDeclaredSeeds(
  values: string[],
  nodeType: "java" | "jsp",
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): DeclaredEntrySeedRecord[] {
  return values
    .map((value) => {
      const normalizedValue = normalizePath(value);
      const matched = nodeTypes.get(normalizedValue) === nodeType;
      return {
        targetType: nodeType,
        value: normalizedValue,
        matched,
        path: matched ? normalizedValue : undefined,
        nodeType: matched ? nodeType : undefined
      };
    })
    .sort((left, right) => left.value.localeCompare(right.value));
}

function buildAdjacency(fileEdges: GraphEdge[]): Map<string, GraphEdge[]> {
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of fileEdges) {
    const edges = adjacency.get(edge.from) ?? [];
    edges.push(edge);
    adjacency.set(edge.from, edges);
  }
  return adjacency;
}

function traverseFromSeeds(
  seeds: string[],
  adjacency: Map<string, GraphEdge[]>,
  nodeTypes: Map<string, Exclude<GraphNodeType, "unresolved">>
): {
  visited: Set<string>;
  edges: Map<string, GraphEdge>;
} {
  const visited = new Set<string>(seeds.map((seed) => normalizePath(seed)));
  const queue = [...visited];
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

  return { visited, edges: collected };
}

function expandDeclaredEntries(
  entries: LeflectEntryDefinition[]
): Array<LeflectEntryDefinition & { variantOf?: string }> {
  return entries.flatMap((entry) => {
    const baseEntry: LeflectEntryDefinition & { variantOf?: string } = {
      ...entry
    };
    const variants = (entry.variants ?? []).map((variant) => ({
      ...entry,
      id: variant.id,
      label: variant.label ?? entry.label,
      description: variant.description ?? entry.description,
      jsp: variant.jsp ?? entry.jsp,
      java: variant.java ?? entry.java,
      query: variant.query ?? entry.query,
      interfaceSpecs: variant.interfaceSpecs ?? entry.interfaceSpecs,
      tags: [...new Set([...(entry.tags ?? []), ...(variant.tags ?? [])])],
      variants: undefined,
      variantOf: entry.id
    }));

    return [baseEntry, ...variants];
  });
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

function normalizeReferenceTargetId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = stripReferenceTypeDecorators(value).trim();
  if (!normalized || normalized.endsWith(".*")) {
    return undefined;
  }
  return normalized;
}

function stripReferenceTypeDecorators(value: string): string {
  let depth = 0;
  let stripped = "";
  for (const character of value) {
    if (character === "<") {
      depth += 1;
      continue;
    }
    if (character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      stripped += character;
    }
  }
  return stripped.replace(/\[\]/g, "").replace(/\.\.\.$/, "").replace(/\s+/g, "");
}

function isLikelyTypeReferenceId(value: string): boolean {
  const normalized = stripReferenceTypeDecorators(value);
  const simpleName = normalized.split(".").at(-1)?.split("$").at(-1) ?? normalized;
  return /^[A-Z]/.test(simpleName);
}

function toJsonl(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}
