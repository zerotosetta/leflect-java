import fs from "fs/promises";
import path from "path";

import { FileDependencyIndex, FileDependencyRecord, FileDependencyReference, GraphEdge, GraphNodeType, SummaryReport } from "@leflect-java/schema";

export type ProjectionDirection = "outbound" | "inbound" | "both";

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

export type ProjectionSnapshot = {
  projectName: string;
  analysisOut: string;
  summary: SummaryReport;
  files: ProjectionFileEntry[];
  filesByPath: Map<string, ProjectionFileEntry>;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdjacency: Map<string, GraphEdge[]>;
  edgeCount: number;
};

export type ProjectionGraphNode = {
  id: string;
  path: string;
  nodeType: GraphNodeType;
  label: string;
  referenceCount: number;
  dependantCount: number;
  isFocus: boolean;
};

export type ProjectionGraphEdge = {
  source: string;
  target: string;
  type: string;
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
  edges: ProjectionGraphEdge[];
};

export async function loadProjectionSnapshot(analysisOut: string, projectName: string): Promise<ProjectionSnapshot> {
  const [summary, fileIndex, edges, javaManifest, jspManifest] = await Promise.all([
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
    readJsonFile<Omit<ProjectionFileManifestEntry, "nodeType">[]>(path.join(analysisOut, "index", "jsp-files.json"), [])
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

  return {
    projectName,
    analysisOut,
    summary,
    files,
    filesByPath,
    adjacency,
    reverseAdjacency,
    edgeCount: edges.length
  };
}

export function buildProjectionGraph(
  snapshot: ProjectionSnapshot,
  focusPath: string,
  direction: ProjectionDirection,
  depth: number,
  maxNodes = 80
): ProjectionGraphResponse {
  const normalizedFocus = normalizePath(focusPath);
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: normalizedFocus, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.path)) {
      continue;
    }
    if (visited.size >= maxNodes) {
      truncated = true;
      break;
    }
    visited.add(current.path);
    if (current.depth >= depth) {
      continue;
    }

    const nextEdges: GraphEdge[] = [];
    if (direction === "outbound" || direction === "both") {
      nextEdges.push(...(snapshot.adjacency.get(current.path) ?? []));
    }
    if (direction === "inbound" || direction === "both") {
      nextEdges.push(...(snapshot.reverseAdjacency.get(current.path) ?? []));
    }

    for (const edge of nextEdges) {
      const neighbor = edge.from === current.path ? edge.to : edge.from;
      if (!visited.has(neighbor)) {
        queue.push({ path: neighbor, depth: current.depth + 1 });
      }
    }
  }

  const aggregatedEdges = new Map<string, ProjectionGraphEdge>();
  for (const nodeId of visited) {
    const relevantEdges = [
      ...(snapshot.adjacency.get(nodeId) ?? []),
      ...(snapshot.reverseAdjacency.get(nodeId) ?? [])
    ];

    for (const edge of relevantEdges) {
      if (!visited.has(edge.from) || !visited.has(edge.to)) {
        continue;
      }
      const key = `${edge.from}::${edge.to}::${edge.type}`;
      const existing = aggregatedEdges.get(key) ?? {
        source: edge.from,
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
      aggregatedEdges.set(key, existing);
    }
  }

  const nodes = [...visited].map((nodeId) => toGraphNode(snapshot, nodeId, normalizedFocus)).sort((left, right) => {
    if (left.isFocus) return -1;
    if (right.isFocus) return 1;
    if (left.nodeType !== right.nodeType) {
      return left.nodeType.localeCompare(right.nodeType);
    }
    return left.path.localeCompare(right.path);
  });
  const edges = [...aggregatedEdges.values()].sort((left, right) => `${left.source}:${left.target}:${left.type}`.localeCompare(`${right.source}:${right.target}:${right.type}`));

  return {
    focusPath: normalizedFocus,
    direction,
    depth,
    truncated,
    stats: {
      nodes: nodes.length,
      edges: edges.length
    },
    nodes,
    edges
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

function toGraphNode(snapshot: ProjectionSnapshot, nodeId: string, focusPath: string): ProjectionGraphNode {
  const file = snapshot.filesByPath.get(nodeId);
  return {
    id: nodeId,
    path: nodeId,
    nodeType: file?.nodeType ?? inferNodeType(nodeId),
    label: nodeId.split("/").at(-1) ?? nodeId,
    referenceCount: file?.referenceCount ?? (snapshot.adjacency.get(nodeId) ?? []).length,
    dependantCount: file?.dependantCount ?? (snapshot.reverseAdjacency.get(nodeId) ?? []).length,
    isFocus: nodeId === focusPath
  };
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

function pushMap(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const existing = map.get(key) ?? [];
  existing.push(edge);
  map.set(key, existing);
}

function normalizePath(targetPath: string): string {
  return targetPath.replace(/\\/g, "/");
}
