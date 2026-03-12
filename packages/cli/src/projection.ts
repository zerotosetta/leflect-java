import fs from "fs/promises";
import path from "path";

import {
  DeclaredEntryDependencyRecord,
  DeclaredEntrySeedRecord,
  EntryDependencyIndex,
  FileDependencyIndex,
  FileDependencyRecord,
  FileDependencyReference,
  GraphEdge,
  GraphNodeType,
  SummaryReport
} from "@leflect-java/schema";

export type ProjectionDirection = "outbound";

export type ProjectionFileManifestEntry = {
  path: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  metadataPath?: string;
  packageName?: string;
  importCount?: number;
  includeCount?: number;
  classCount?: number;
  methodCount?: number;
  callCount?: number;
  classReferenceCount?: number;
  methodCallCount?: number;
  taglibCount?: number;
  tagCount?: number;
  scriptletCount?: number;
  resolvedTagCount?: number;
};

export type ProjectionFileEntry = Omit<ProjectionFileManifestEntry, "nodeType"> & {
  nodeType: GraphNodeType;
  referenceCount: number;
  dependantCount: number;
  references: FileDependencyReference[];
  referencedBy: FileDependencyReference[];
};

export type ProjectionEntrySource = "declared" | "matched";

export type ProjectionEntry = {
  id: string;
  label: string;
  source: ProjectionEntrySource;
  entryType?: string;
  focusPath?: string;
  focusNodeType?: Exclude<GraphNodeType, "unresolved">;
  description?: string;
  tags: string[];
  variantOf?: string;
  matchedBy: string[];
  seedPaths: string[];
  nodeCount: number;
  edgeCount: number;
  reachableCount: number;
  disabled: boolean;
};

type ProjectionEntryGraph = {
  id: string;
  label: string;
  source: ProjectionEntrySource;
  entryType?: string;
  focusPath?: string;
  seedPaths: string[];
  adjacency: Map<string, GraphEdge[]>;
};

export type ProjectionSnapshot = {
  projectName: string;
  analysisOut: string;
  summary: SummaryReport;
  files: ProjectionFileEntry[];
  filesByPath: Map<string, ProjectionFileEntry>;
  entries: ProjectionEntry[];
  entryGraphsById: Map<string, ProjectionEntryGraph>;
  defaultEntryId?: string;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdjacency: Map<string, GraphEdge[]>;
  edgeCount: number;
};

export type ProjectionGraphNode = {
  id: string;
  path: string;
  nodeType: GraphNodeType | "entry";
  label: string;
  referenceCount: number;
  dependantCount: number;
  isFocus: boolean;
  parentId?: string;
  depth: number;
  edgeType?: string;
  confidence: string[];
  symbols: string[];
};

export type ProjectionGraphResponse = {
  focusPath: string;
  direction: ProjectionDirection;
  depth: number;
  truncated: boolean;
  stats: {
    nodes: number;
    edges: number;
  };
  nodes: ProjectionGraphNode[];
};

export async function loadProjectionSnapshot(analysisOut: string, projectName: string): Promise<ProjectionSnapshot> {
  const [summary, fileIndex, edges, javaManifest, jspManifest, entryIndex] = await Promise.all([
    readJsonFile<SummaryReport>(path.join(analysisOut, "report", "summary.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date(0).toISOString(),
      counts: {
        classes: 0,
        methods: 0,
        jsps: 0,
        taglibs: 0,
        javaCallEdges: 0,
        jspJavaEdges: 0,
        unresolvedEdges: 0
      },
      labels: {
        classes: { SERVICE: 0, DAO: 0, CONTROLLER: 0, TAG_HANDLER: 0, UTIL: 0, DTO: 0, UNKNOWN: 0 },
        methods: { SERVICE_METHOD: 0, TAG_ENTRYPOINT: 0, ACCESSOR: 0, UNKNOWN: 0 },
        jsps: { PAGE: 0, FRAGMENT: 0, AJAX_VIEW: 0, UNKNOWN: 0 }
      },
      jspImpacts: []
    }),
    readJsonFile<FileDependencyIndex>(path.join(analysisOut, "graph", "file-dependencies.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date(0).toISOString(),
      files: []
    }),
    readJsonlFile<GraphEdge>(path.join(analysisOut, "graph", "file-dependency.jsonl")),
    readJsonFile<Omit<ProjectionFileManifestEntry, "nodeType">[]>(path.join(analysisOut, "index", "java-files.json"), []),
    readJsonFile<Omit<ProjectionFileManifestEntry, "nodeType">[]>(path.join(analysisOut, "index", "jsp-files.json"), []),
    readJsonFile<EntryDependencyIndex>(path.join(analysisOut, "graph", "entry-dependencies.json"), {
      schemaVersion: "1.0",
      generatedAt: new Date(0).toISOString(),
      patterns: { java: [], jsp: [] },
      matchedEntries: [],
      unmatchedPatterns: [],
      entries: [],
      declaredEntries: []
    })
  ]);

  const filesByPath = new Map<string, ProjectionFileEntry>();
  const manifestEntries: ProjectionFileManifestEntry[] = [
    ...javaManifest.map((entry) => ({ ...entry, nodeType: "java" as const })),
    ...jspManifest.map((entry) => ({ ...entry, nodeType: "jsp" as const }))
  ];
  const manifestByPath = new Map(manifestEntries.map((entry) => [normalizePath(entry.path), entry]));

  for (const record of fileIndex.files) {
    const normalizedPath = normalizePath(record.path);
    const manifest = manifestByPath.get(normalizedPath);
    filesByPath.set(normalizedPath, {
      path: normalizedPath,
      nodeType: record.nodeType,
      metadataPath: manifest?.metadataPath,
      packageName: manifest?.packageName,
      importCount: manifest?.importCount,
      includeCount: manifest?.includeCount,
      classCount: manifest?.classCount,
      methodCount: manifest?.methodCount,
      callCount: manifest?.callCount,
      classReferenceCount: manifest?.classReferenceCount,
      methodCallCount: manifest?.methodCallCount,
      taglibCount: manifest?.taglibCount,
      tagCount: manifest?.tagCount,
      scriptletCount: manifest?.scriptletCount,
      resolvedTagCount: manifest?.resolvedTagCount,
      referenceCount: record.referenceCount,
      dependantCount: record.dependantCount,
      references: normalizeReferences(record.references),
      referencedBy: normalizeReferences(record.referencedBy)
    });
  }

  for (const manifest of manifestEntries) {
    const normalizedPath = normalizePath(manifest.path);
    if (filesByPath.has(normalizedPath)) {
      continue;
    }
    filesByPath.set(normalizedPath, {
      ...manifest,
      path: normalizedPath,
      referenceCount: 0,
      dependantCount: 0,
      references: [],
      referencedBy: []
    });
  }

  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdjacency = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const normalized = {
      ...edge,
      from: normalizePath(edge.from),
      to: normalizePath(edge.to),
      fromFile: edge.fromFile ? normalizePath(edge.fromFile) : undefined,
      toFile: edge.toFile ? normalizePath(edge.toFile) : undefined
    } satisfies GraphEdge;
    pushMap(adjacency, normalized.from, normalized);
    pushMap(reverseAdjacency, normalized.to, normalized);
  }

  const files = [...filesByPath.values()].sort(compareFiles);
  const { entries, entryGraphsById } = buildProjectionEntries(entryIndex);
  const defaultEntryId = entries.find((entry) => !entry.disabled)?.id ?? entries[0]?.id;

  return {
    projectName,
    analysisOut,
    summary,
    files,
    filesByPath,
    entries,
    entryGraphsById,
    defaultEntryId,
    adjacency,
    reverseAdjacency,
    edgeCount: edges.length
  };
}

export function buildProjectionGraph(
  snapshot: ProjectionSnapshot,
  options: {
    focusPath?: string;
    depth: number;
    maxNodes?: number;
    entryId?: string;
  }
): ProjectionGraphResponse {
  const entryGraph = options.entryId ? snapshot.entryGraphsById.get(options.entryId) : undefined;
  if (entryGraph?.source === "declared") {
    return buildDeclaredEntryGraph(snapshot, entryGraph, options.depth, options.maxNodes ?? 80);
  }
  if (!options.focusPath) {
    return {
      focusPath: options.entryId ? entryNodeId(options.entryId) : "",
      direction: "outbound",
      depth: options.depth,
      truncated: false,
      stats: { nodes: 0, edges: 0 },
      nodes: []
    };
  }

  const normalizedFocus = normalizePath(options.focusPath);
  const visited = new Set<string>([normalizedFocus]);
  const queue: Array<{ path: string; depth: number; parentId?: string; edge?: AggregatedTreeEdge }> = [
    { path: normalizedFocus, depth: 0 }
  ];
  const nodes = new Map<string, ProjectionGraphNode>([
    [
      normalizedFocus,
      toGraphNode(snapshot, normalizedFocus, normalizedFocus, 0, undefined, undefined)
    ]
  ]);
  let truncated = false;
  let edgeCount = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= options.depth) {
      continue;
    }

    const nextEdges = aggregateTreeEdges(snapshot.adjacency.get(current.path) ?? []);
    for (const edge of nextEdges) {
      if (visited.has(edge.target)) {
        continue;
      }
      if (nodes.size >= (options.maxNodes ?? 80)) {
        truncated = true;
        break;
      }
      visited.add(edge.target);
      edgeCount += 1;
      const childDepth = current.depth + 1;
      nodes.set(
        edge.target,
        toGraphNode(snapshot, edge.target, normalizedFocus, childDepth, current.path, edge)
      );
      queue.push({ path: edge.target, depth: childDepth, parentId: current.path, edge });
    }
  }

  const orderedNodes = [...nodes.values()].sort((left, right) => {
    if (left.isFocus) return -1;
    if (right.isFocus) return 1;
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    if (left.nodeType !== right.nodeType) {
      return left.nodeType.localeCompare(right.nodeType);
    }
    return left.path.localeCompare(right.path);
  });

  return {
    focusPath: normalizedFocus,
    direction: "outbound",
    depth: options.depth,
    truncated,
    stats: {
      nodes: orderedNodes.length,
      edges: edgeCount
    },
    nodes: orderedNodes
  };
}

export async function loadProjectionFileDetail(snapshot: ProjectionSnapshot, targetPath: string): Promise<{
  file: ProjectionFileEntry;
  metadata?: Record<string, unknown>;
  references: FileDependencyReference[];
  referencedBy: FileDependencyReference[];
}> {
  const normalizedPath = normalizePath(targetPath);
  const existing = snapshot.filesByPath.get(normalizedPath) ?? {
    path: normalizedPath,
    nodeType: inferNodeType(normalizedPath),
    referenceCount: (snapshot.adjacency.get(normalizedPath) ?? []).length,
    dependantCount: (snapshot.reverseAdjacency.get(normalizedPath) ?? []).length,
    references: [],
    referencedBy: []
  };

  let metadata: Record<string, unknown> | undefined;
  if (existing.metadataPath) {
    metadata = await readJsonFile<Record<string, unknown> | undefined>(
      path.join(snapshot.analysisOut, "index", existing.metadataPath),
      undefined
    );
  }

  return {
    file: existing,
    metadata,
    references: existing.references,
    referencedBy: existing.referencedBy
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function normalizeReferences(entries: FileDependencyReference[]): FileDependencyReference[] {
  return entries
    .map((entry) => ({
      ...entry,
      path: normalizePath(entry.path),
      symbols: [...entry.symbols].sort()
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function compareFiles(left: ProjectionFileEntry, right: ProjectionFileEntry): number {
  if (left.nodeType !== right.nodeType) {
    return left.nodeType.localeCompare(right.nodeType);
  }
  return left.path.localeCompare(right.path);
}

function buildProjectionEntries(entryIndex: EntryDependencyIndex): {
  entries: ProjectionEntry[];
  entryGraphsById: Map<string, ProjectionEntryGraph>;
} {
  const entryGraphsById = new Map<string, ProjectionEntryGraph>();
  const declaredEntries = entryIndex.declaredEntries.map((entry) => {
    const seedRecords = [...entry.seeds.jsp, ...entry.seeds.java];
    const focusSeed = resolveDeclaredEntryFocusSeed(entry);
    const seedPaths = uniquePaths(seedRecords.map((seed) => seed.path ?? seed.value));
    entryGraphsById.set(entry.id, {
      id: entry.id,
      label: entry.label ?? entry.id,
      source: "declared",
      entryType: entry.type,
      focusPath: focusSeed?.path ? normalizePath(focusSeed.path) : undefined,
      seedPaths,
      adjacency: buildAdjacency(entry.edges)
    });
    return {
      id: entry.id,
      label: entry.label ?? entry.id,
      source: "declared" as const,
      entryType: entry.type,
      focusPath: focusSeed?.path ? normalizePath(focusSeed.path) : undefined,
      focusNodeType: focusSeed?.nodeType ?? resolveSeedNodeType(focusSeed?.targetType),
      description: entry.description,
      tags: [...(entry.tags ?? [])].sort(),
      variantOf: entry.variantOf,
      matchedBy: [],
      seedPaths,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      reachableCount: entry.reachableFiles.length,
      disabled: !focusSeed?.path
    };
  });

  const matchedEntries = entryIndex.entries.map((entry) => {
    const normalizedEntryPath = normalizePath(entry.entry);
    entryGraphsById.set(normalizedEntryPath, {
      id: normalizedEntryPath,
      label: entry.entry.split("/").at(-1) ?? entry.entry,
      source: "matched",
      entryType: "matched_file",
      focusPath: normalizedEntryPath,
      seedPaths: [normalizedEntryPath],
      adjacency: buildAdjacency(entry.edges)
    });
    return {
      id: normalizedEntryPath,
      label: entry.entry.split("/").at(-1) ?? entry.entry,
      source: "matched" as const,
      entryType: "matched_file",
      focusPath: normalizedEntryPath,
      focusNodeType: entry.nodeType,
      description: undefined,
      tags: [],
      variantOf: undefined,
      matchedBy: [...entry.matchedBy].sort(),
      seedPaths: [normalizedEntryPath],
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      reachableCount: entry.reachableFiles.length,
      disabled: false
    };
  });

  return {
    entries: [...declaredEntries, ...matchedEntries].sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "declared" ? -1 : 1;
      }
      if (left.variantOf && !right.variantOf) {
        return 1;
      }
      if (!left.variantOf && right.variantOf) {
        return -1;
      }
      return left.label.localeCompare(right.label);
    }),
    entryGraphsById
  };
}

function buildDeclaredEntryGraph(
  snapshot: ProjectionSnapshot,
  entryGraph: ProjectionEntryGraph,
  depth: number,
  maxNodes: number
): ProjectionGraphResponse {
  const rootId = entryNodeId(entryGraph.id);
  const nodes = new Map<string, ProjectionGraphNode>([
    [
      rootId,
      {
        id: rootId,
        path: rootId,
        nodeType: "entry",
        label: entryGraph.label,
        referenceCount: entryGraph.seedPaths.length,
        dependantCount: 0,
        isFocus: true,
        depth: 0,
        confidence: [],
        symbols: []
      }
    ]
  ]);
  const visited = new Set<string>([rootId]);
  const queue: Array<{ path: string; depth: number }> = [];
  let truncated = false;
  let edgeCount = 0;

  if (depth >= 1) {
    for (const seedPath of entryGraph.seedPaths) {
      if (visited.has(seedPath)) {
        continue;
      }
      if (nodes.size >= maxNodes) {
        truncated = true;
        break;
      }
      visited.add(seedPath);
      nodes.set(
        seedPath,
        toGraphNode(snapshot, seedPath, rootId, 1, rootId, {
          target: seedPath,
          type: "ENTRY_SEED",
          confidence: [],
          symbols: []
        })
      );
      queue.push({ path: seedPath, depth: 1 });
      edgeCount += 1;
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) {
      continue;
    }

    const nextEdges = aggregateTreeEdges(entryGraph.adjacency.get(current.path) ?? []);
    for (const edge of nextEdges) {
      if (visited.has(edge.target)) {
        continue;
      }
      if (nodes.size >= maxNodes) {
        truncated = true;
        break;
      }
      visited.add(edge.target);
      edgeCount += 1;
      const childDepth = current.depth + 1;
      nodes.set(edge.target, toGraphNode(snapshot, edge.target, rootId, childDepth, current.path, edge));
      queue.push({ path: edge.target, depth: childDepth });
    }
  }

  const orderedNodes = [...nodes.values()].sort(compareGraphNodes);

  return {
    focusPath: rootId,
    direction: "outbound",
    depth,
    truncated,
    stats: {
      nodes: orderedNodes.length,
      edges: edgeCount
    },
    nodes: orderedNodes
  };
}

type AggregatedTreeEdge = {
  target: string;
  type: string;
  confidence: string[];
  symbols: string[];
};

function toGraphNode(
  snapshot: ProjectionSnapshot,
  nodeId: string,
  focusPath: string,
  depth: number,
  parentId?: string,
  edge?: AggregatedTreeEdge
): ProjectionGraphNode {
  const file = snapshot.filesByPath.get(nodeId);
  return {
    id: nodeId,
    path: nodeId,
    nodeType: file?.nodeType ?? inferNodeType(nodeId),
    label: nodeId.split("/").at(-1) ?? nodeId,
    referenceCount: file?.referenceCount ?? (snapshot.adjacency.get(nodeId) ?? []).length,
    dependantCount: file?.dependantCount ?? (snapshot.reverseAdjacency.get(nodeId) ?? []).length,
    isFocus: nodeId === focusPath,
    parentId,
    depth,
    edgeType: edge?.type,
    confidence: edge?.confidence ?? [],
    symbols: edge?.symbols ?? []
  };
}

function aggregateTreeEdges(edges: GraphEdge[]): AggregatedTreeEdge[] {
  const aggregated = new Map<string, AggregatedTreeEdge>();

  for (const edge of edges) {
    const key = edge.to;
    const existing = aggregated.get(key) ?? {
      target: edge.to,
      type: edge.type,
      confidence: [],
      symbols: []
    };
    if (!existing.confidence.includes(edge.confidence)) {
      existing.confidence.push(edge.confidence);
    }
    for (const symbol of [edge.fromSymbol, edge.toSymbol]) {
      if (symbol && !existing.symbols.includes(symbol)) {
        existing.symbols.push(symbol);
      }
    }
    if (existing.type !== edge.type && !existing.type.includes(edge.type)) {
      existing.type = `${existing.type},${edge.type}`;
    }
    aggregated.set(key, existing);
  }

  return [...aggregated.values()].sort((left, right) => left.target.localeCompare(right.target));
}

function compareGraphNodes(left: ProjectionGraphNode, right: ProjectionGraphNode): number {
  if (left.isFocus) return -1;
  if (right.isFocus) return 1;
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  if (left.nodeType !== right.nodeType) {
    return left.nodeType.localeCompare(right.nodeType);
  }
  return left.path.localeCompare(right.path);
}

function buildAdjacency(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    pushMap(adjacency, normalizePath(edge.from), {
      ...edge,
      from: normalizePath(edge.from),
      to: normalizePath(edge.to),
      fromFile: edge.fromFile ? normalizePath(edge.fromFile) : undefined,
      toFile: edge.toFile ? normalizePath(edge.toFile) : undefined
    });
  }
  return adjacency;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => normalizePath(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function entryNodeId(entryId: string): string {
  return `entry:${entryId}`;
}

function inferNodeType(value: string): GraphNodeType {
  if (value.endsWith(".jsp")) {
    return "jsp";
  }
  if (value.endsWith(".java")) {
    return "java";
  }
  return "unresolved";
}

function resolveSeedNodeType(value?: "java" | "jsp"): Exclude<GraphNodeType, "unresolved"> | undefined {
  if (value === "java" || value === "jsp") {
    return value;
  }
  return undefined;
}

function resolveDeclaredEntryFocusSeed(entry: DeclaredEntryDependencyRecord): DeclaredEntrySeedRecord | undefined {
  const matchedJspSeeds = entry.seeds.jsp.filter((seed) => seed.matched && seed.path);
  const matchedJavaSeeds = entry.seeds.java.filter((seed) => seed.matched && seed.path);
  const jspSeeds = entry.seeds.jsp.filter((seed) => seed.path);
  const javaSeeds = entry.seeds.java.filter((seed) => seed.path);
  const nonFragmentJsp = (seeds: DeclaredEntrySeedRecord[]) =>
    seeds.find((seed) => seed.path && !seed.path.includes("/fragments/"));

  if (entry.variantOf) {
    return (
      matchedJavaSeeds[0] ??
      nonFragmentJsp(matchedJspSeeds) ??
      matchedJspSeeds[0] ??
      javaSeeds[0] ??
      nonFragmentJsp(jspSeeds) ??
      jspSeeds[0]
    );
  }

  return (
    nonFragmentJsp(matchedJspSeeds) ??
    matchedJspSeeds[0] ??
    matchedJavaSeeds[0] ??
    nonFragmentJsp(jspSeeds) ??
    jspSeeds[0] ??
    javaSeeds[0]
  );
}

function pushMap(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const existing = map.get(key) ?? [];
  existing.push(edge);
  map.set(key, existing);
}

function normalizePath(targetPath: string): string {
  return targetPath.replace(/\\/g, "/");
}
