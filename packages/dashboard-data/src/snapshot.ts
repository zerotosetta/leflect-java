import path from "path";

import { flattenJavaFileMetadata, flattenJspFileMetadata, readJavaFileMetadataDir, readJspFileMetadataDir } from "@leflect-java/indexer";
import { GraphNodeType, LabelsIndex, SummaryReport, UnresolvedReport } from "@leflect-java/schema";

import {
  DashboardClassRecord,
  DashboardContext,
  DashboardEntry,
  DashboardEntryDependencyIndex,
  DashboardFileDependency,
  DashboardFileDependencyIndex,
  DashboardGraphEdge,
  DashboardJavaMethodCall,
  DashboardJspMethodCall,
  DashboardJspRecord,
  DashboardMethodRecord,
  DashboardNodeSummary,
  DashboardZoneSummary
} from "./types";
import { dashboardPoliciesPath } from "./policies";
import { normalizePath, readJsonFile, readJsonlFile, simpleName, sortStrings, statSignature, unique } from "./util";

export type RawNodeRecord = DashboardNodeSummary & {
  representativeClasses: string[];
  references: DashboardFileDependency["references"];
  referencedBy: DashboardFileDependency["referencedBy"];
  matchKeys: string[];
  zoneLabel: string;
};

export type RawZoneRecord = DashboardZoneSummary & {
  matchKeys: string[];
  nodeIds: string[];
  rawEdgeCount: number;
  reachableEntries: string[];
};

export type LoadedDashboardSnapshot = {
  context: DashboardContext;
  generatedAt: string;
  summary: SummaryReport;
  unresolved: UnresolvedReport;
  labels?: LabelsIndex;
  classes: DashboardClassRecord[];
  methods: DashboardMethodRecord[];
  jsps: DashboardJspRecord[];
  fileDependencyIndex: DashboardFileDependencyIndex;
  entryDependencyIndex: DashboardEntryDependencyIndex;
  fileEdges: DashboardGraphEdge[];
  javaMethodCalls: DashboardJavaMethodCall[];
  jspMethodCalls: DashboardJspMethodCall[];
  entries: DashboardEntry[];
  defaultEntryId?: string;
  nodes: RawNodeRecord[];
  zones: RawZoneRecord[];
  nodesById: Map<string, RawNodeRecord>;
  zonesById: Map<string, RawZoneRecord>;
  adjacency: Map<string, DashboardGraphEdge[]>;
  reverseAdjacency: Map<string, DashboardGraphEdge[]>;
};

type SnapshotCacheRecord = {
  signature: string;
  snapshot: LoadedDashboardSnapshot;
};

const snapshotCache = new Map<string, SnapshotCacheRecord>();

export async function loadDashboardSnapshot(context: DashboardContext): Promise<LoadedDashboardSnapshot> {
  const analysisOut = context.analysisOut;
  const signature = await statSignature([
    path.join(analysisOut, "report", "summary.json"),
    path.join(analysisOut, "report", "unresolved.json"),
    path.join(analysisOut, "index", "java-files.json"),
    path.join(analysisOut, "index", "jsp-files.json"),
    path.join(analysisOut, "graph", "file-dependencies.json"),
    path.join(analysisOut, "graph", "file-dependency.jsonl"),
    path.join(analysisOut, "graph", "entry-dependencies.json"),
    path.join(analysisOut, "index", "labels.json"),
    dashboardPoliciesPath(analysisOut)
  ]);

  const cached = snapshotCache.get(analysisOut);
  if (cached && cached.signature === signature) {
    return cached.snapshot;
  }

  const summary = await readJsonFile<SummaryReport>(path.join(analysisOut, "report", "summary.json"), {
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
      classes: {
        SERVICE: 0,
        DAO: 0,
        CONTROLLER: 0,
        TAG_HANDLER: 0,
        UTIL: 0,
        DTO: 0,
        UNKNOWN: 0
      },
      methods: {
        SERVICE_METHOD: 0,
        TAG_ENTRYPOINT: 0,
        ACCESSOR: 0,
        UNKNOWN: 0
      },
      jsps: {
        PAGE: 0,
        FRAGMENT: 0,
        AJAX_VIEW: 0,
        UNKNOWN: 0
      }
    },
    jspImpacts: []
  });
  const unresolved = await readJsonFile<UnresolvedReport>(path.join(analysisOut, "report", "unresolved.json"), {
    schemaVersion: "1.0",
    generatedAt: new Date(0).toISOString(),
    edges: [],
    diagnostics: [],
    byPath: [],
    byCause: []
  });
  const labels = await readJsonFile<LabelsIndex | undefined>(path.join(analysisOut, "index", "labels.json"), undefined);
  const javaMetadata = await readJavaFileMetadataDir(path.join(analysisOut, "index"));
  const jspMetadata = await readJspFileMetadataDir(path.join(analysisOut, "index"));
  const javaIndex = javaMetadata.length > 0 ? flattenJavaFileMetadata(javaMetadata) : undefined;
  const jspIndex = jspMetadata.length > 0 ? flattenJspFileMetadata(jspMetadata) : undefined;
  const classes = (javaIndex?.classes ?? await readJsonFile<DashboardClassRecord[]>(path.join(analysisOut, "index", "classes.json"), [])) as DashboardClassRecord[];
  const methods = (javaIndex?.methods ?? await readJsonFile<DashboardMethodRecord[]>(path.join(analysisOut, "index", "methods.json"), [])) as DashboardMethodRecord[];
  const jsps = (jspIndex?.docs ?? await readJsonFile<DashboardJspRecord[]>(path.join(analysisOut, "index", "jsp-docs.json"), [])) as DashboardJspRecord[];
  const fileDependencyIndex = await readJsonFile<DashboardFileDependencyIndex>(
    path.join(analysisOut, "graph", "file-dependencies.json"),
    { schemaVersion: "1.0", generatedAt: new Date(0).toISOString(), files: [] }
  );
  const entryDependencyIndex = await readJsonFile<DashboardEntryDependencyIndex>(
    path.join(analysisOut, "graph", "entry-dependencies.json"),
    {
      schemaVersion: "1.0",
      generatedAt: new Date(0).toISOString(),
      patterns: { java: [], jsp: [] },
      matchedEntries: [],
      unmatchedPatterns: [],
      entries: []
    }
  );
  const fileEdges = await readJsonlFile<DashboardGraphEdge>(path.join(analysisOut, "graph", "file-dependency.jsonl"));
  const javaMethodCalls = (javaIndex?.calls ?? await readJsonFile<DashboardJavaMethodCall[]>(
    path.join(analysisOut, "index", "java-method-calls.json"),
    []
  )) as DashboardJavaMethodCall[];
  const jspMethodCalls = (jspIndex?.methodCalls ?? await readJsonFile<DashboardJspMethodCall[]>(
    path.join(analysisOut, "index", "jsp-method-calls.json"),
    []
  )) as DashboardJspMethodCall[];

  const classesByFile = new Map<string, DashboardClassRecord[]>();
  const methodsByFile = new Map<string, DashboardMethodRecord[]>();
  for (const entry of classes) {
    if (!entry.file) {
      continue;
    }
    const file = normalizePath(entry.file);
    const existing = classesByFile.get(file) ?? [];
    existing.push({ ...entry, file });
    classesByFile.set(file, existing);
  }
  for (const entry of methods) {
    if (!entry.file) {
      continue;
    }
    const file = normalizePath(entry.file);
    const existing = methodsByFile.get(file) ?? [];
    existing.push({ ...entry, file });
    methodsByFile.set(file, existing);
  }

  const nodesById = new Map<string, RawNodeRecord>();
  for (const entry of fileDependencyIndex.files) {
    const node = createNodeRecord(entry, classesByFile.get(normalizePath(entry.path)) ?? [], methodsByFile.get(normalizePath(entry.path)) ?? [], labels);
    nodesById.set(node.id, node);
  }

  for (const edge of fileEdges) {
    for (const endpoint of [edge.from, edge.to]) {
      const nodeId = normalizePath(endpoint);
      if (nodesById.has(nodeId)) {
        continue;
      }
      const nodeType: GraphNodeType = inferNodeTypeFromId(nodeId);
      const zone = deriveZone(nodeType, nodeId);
      nodesById.set(nodeId, {
        id: nodeId,
        label: simpleName(nodeId) ?? nodeId,
        kind: "external",
        nodeType,
        path: nodeId,
        zoneId: zone.id,
        classId: nodeType === "unresolved" ? nodeId : undefined,
        packageName: nodeType === "unresolved" ? parentPackage(nodeId) : undefined,
        labels: [],
        isEntry: false,
        incomingCount: 0,
        outgoingCount: 0,
        collapsed: false,
        summarized: false,
        hidden: false,
        representativeClasses: nodeType === "unresolved" ? [nodeId] : [],
        references: [],
        referencedBy: [],
        matchKeys: zone.matchKeys,
        zoneLabel: zone.label,
        action: undefined
      });
    }
  }

  const adjacency = new Map<string, DashboardGraphEdge[]>();
  const reverseAdjacency = new Map<string, DashboardGraphEdge[]>();
  for (const edge of fileEdges) {
    const from = normalizePath(edge.from);
    const to = normalizePath(edge.to);
    const normalized = {
      ...edge,
      from,
      to,
      fromFile: edge.fromFile ? normalizePath(edge.fromFile) : undefined,
      toFile: edge.toFile ? normalizePath(edge.toFile) : undefined
    } satisfies DashboardGraphEdge;
    pushMap(adjacency, from, normalized);
    pushMap(reverseAdjacency, to, normalized);
  }

  for (const node of nodesById.values()) {
    node.outgoingCount = adjacency.get(node.id)?.length ?? 0;
    node.incomingCount = reverseAdjacency.get(node.id)?.length ?? 0;
  }

  const entries = createEntries(jsps, classes, labels, entryDependencyIndex);
  const defaultEntryId = entries[0]?.id;

  const zonesById = new Map<string, RawZoneRecord>();
  for (const node of nodesById.values()) {
    const existing = zonesById.get(node.zoneId) ?? createEmptyZone(node.zoneId, node.zoneLabel);
    existing.nodeIds.push(node.id);
    existing.visibleNodeCount += 1;
    existing.nodeCount += 1;
    existing.classCount += node.classCount ?? (node.classId ? 1 : 0);
    existing.methodCount += node.methodCount ?? 0;
    existing.topClasses = takeTopClassNames(existing.topClasses, node.representativeClasses);
    existing.nodeKinds =
      node.nodeType === "zone"
        ? existing.nodeKinds
        : unique([...existing.nodeKinds, node.nodeType]);
    existing.matchKeys = unique([...existing.matchKeys, ...node.matchKeys]);
    zonesById.set(existing.id, existing);
  }

  const entryReachSets = createEntryReachSets(entries, entryDependencyIndex, adjacency);
  const totalEntries = Math.max(entries.length, 1);
  for (const zone of zonesById.values()) {
    zone.reachableEntries = [];
    zone.fanIn = 0;
    zone.fanOut = 0;
    zone.edgeBreakdown = {};
    zone.rawEdgeCount = 0;
  }

  for (const [entryId, reachable] of entryReachSets.entries()) {
    const seenZones = new Set<string>();
    for (const nodeId of reachable) {
      const zone = zonesById.get(nodesById.get(nodeId)?.zoneId ?? "");
      if (!zone || seenZones.has(zone.id)) {
        continue;
      }
      zone.reachableEntries.push(entryId);
      seenZones.add(zone.id);
    }
  }

  const zoneIn = new Map<string, Set<string>>();
  const zoneOut = new Map<string, Set<string>>();
  for (const edge of fileEdges) {
    const sourceZone = nodesById.get(normalizePath(edge.from))?.zoneId;
    const targetZone = nodesById.get(normalizePath(edge.to))?.zoneId;
    if (!sourceZone || !targetZone) {
      continue;
    }
    const source = zonesById.get(sourceZone);
    const target = zonesById.get(targetZone);
    if (!source || !target) {
      continue;
    }
    source.rawEdgeCount += 1;
    source.edgeBreakdown[edge.type] = (source.edgeBreakdown[edge.type] ?? 0) + 1;
    pushSetMap(zoneOut, sourceZone, targetZone);
    pushSetMap(zoneIn, targetZone, sourceZone);
  }

  for (const zone of zonesById.values()) {
    zone.entryCoverage = zone.reachableEntries.length / totalEntries;
    zone.packageCount = unique(
      zone.nodeIds
        .map((nodeId: string) => snapshotNodePackage(nodesById.get(nodeId)))
        .filter((value: string | undefined): value is string => Boolean(value))
    ).length;
    zone.fanIn = zoneIn.get(zone.id)?.size ?? 0;
    zone.fanOut = zoneOut.get(zone.id)?.size ?? 0;
    zone.topClasses = takeTopClassNames(zone.topClasses, []);
  }

  const snapshot: LoadedDashboardSnapshot = {
    context: {
      ...context,
      projectName: context.projectName ?? path.basename(context.root)
    },
    generatedAt: new Date().toISOString(),
    summary,
    unresolved,
    labels,
    classes,
    methods,
    jsps,
    fileDependencyIndex,
    entryDependencyIndex,
    fileEdges,
    javaMethodCalls,
    jspMethodCalls,
    entries,
    defaultEntryId,
    nodes: [...nodesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    zones: [...zonesById.values()].sort((left, right) => left.label.localeCompare(right.label)),
    nodesById,
    zonesById,
    adjacency,
    reverseAdjacency
  };

  enrichRepresentativePaths(snapshot, entryReachSets);
  snapshotCache.set(analysisOut, { signature, snapshot });
  return snapshot;
}

function createNodeRecord(
  record: DashboardFileDependency,
  classes: DashboardClassRecord[],
  methods: DashboardMethodRecord[],
  labels?: LabelsIndex
): RawNodeRecord {
  const normalizedPath = normalizePath(record.path);
  const primaryClass = classes[0];
  const zone = deriveZone(record.nodeType, normalizedPath, primaryClass?.packageName);
  return {
    id: normalizedPath,
    label: record.nodeType === "jsp" ? path.basename(normalizedPath) : primaryClass?.name ?? path.basename(normalizedPath),
    kind: "file",
    nodeType: record.nodeType,
    path: normalizedPath,
    zoneId: zone.id,
    classId: primaryClass?.id,
    packageName: primaryClass?.packageName,
    labels: resolveNodeLabels(record, primaryClass, labels),
    isEntry: false,
    incomingCount: record.dependantCount,
    outgoingCount: record.referenceCount,
    collapsed: false,
    summarized: false,
    hidden: false,
    classCount: classes.length,
    methodCount: methods.length,
    packageCount: classes.length > 0 ? unique(classes.map((entry) => entry.packageName).filter(Boolean) as string[]).length : 0,
    representativeClasses: classes.map((entry) => entry.name).slice(0, 5),
    references: record.references,
    referencedBy: record.referencedBy,
    matchKeys: zone.matchKeys,
    zoneLabel: zone.label,
    action: undefined
  };
}

function resolveNodeLabels(
  record: DashboardFileDependency,
  primaryClass: DashboardClassRecord | undefined,
  labels: LabelsIndex | undefined
): string[] {
  if (!labels) {
    return [];
  }
  if (record.nodeType === "jsp") {
    return labels.jsps[normalizePath(record.path)] ?? [];
  }
  if (primaryClass?.id) {
    return labels.classes[primaryClass.id] ?? [];
  }
  return [];
}

function createEntries(
  jsps: DashboardJspRecord[],
  classes: DashboardClassRecord[],
  labels: LabelsIndex | undefined,
  entryDependencyIndex: DashboardEntryDependencyIndex
): DashboardEntry[] {
  const matched = new Map(entryDependencyIndex.matchedEntries.map((entry) => [normalizePath(entry.path), entry.matchedBy]));
  const result: DashboardEntry[] = [];

  for (const jsp of jsps) {
    const pathValue = normalizePath(jsp.path);
    result.push({
      id: pathValue,
      type: "jsp",
      label: path.basename(pathValue),
      path: pathValue,
      matchedBy: matched.get(pathValue) ?? []
    });
  }

  for (const entry of classes) {
    if (!entry.file) {
      continue;
    }
    const labelSet = new Set(labels?.classes[entry.id] ?? []);
    const type = resolveEntryType(entry, labelSet);
    if (!type) {
      continue;
    }
    const filePath = normalizePath(entry.file);
    result.push({
      id: filePath,
      type,
      label: entry.name,
      path: filePath,
      classId: entry.id,
      packageName: entry.packageName,
      matchedBy: matched.get(filePath) ?? []
    });
  }

  return result.sort((left, right) => {
    const typeOrder = entryTypeOrder(left.type) - entryTypeOrder(right.type);
    if (typeOrder !== 0) {
      return typeOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

function resolveEntryType(entry: DashboardClassRecord, labelSet: Set<string>): DashboardEntry["type"] | undefined {
  if (labelSet.has("CONTROLLER") || entry.name.endsWith("Controller")) {
    return "controller";
  }
  if (entry.name.endsWith("Action")) {
    return "action";
  }
  if (labelSet.has("SERVICE") || entry.name.endsWith("Service") || entry.packageName?.includes(".service")) {
    return "service";
  }
  return undefined;
}

function entryTypeOrder(type: DashboardEntry["type"]): number {
  switch (type) {
    case "jsp":
      return 0;
    case "controller":
      return 1;
    case "action":
      return 2;
    case "service":
      return 3;
  }
}

function deriveZone(nodeType: GraphNodeType, pathOrClass: string, packageName?: string): {
  id: string;
  label: string;
  matchKeys: string[];
} {
  if (nodeType === "jsp") {
    const normalized = normalizePath(pathOrClass);
    const marker = normalized.includes("/WEB-INF/jsp/")
      ? "/WEB-INF/jsp/"
      : normalized.includes("/webapp/")
        ? "/webapp/"
        : "/";
    const relative = normalized.split(marker).at(-1) ?? normalized;
    const segments = relative.split("/").filter(Boolean);
    const group = segments.slice(0, Math.max(1, Math.min(2, segments.length - 1))).join("/") || "root";
    const label = `jsp:${group.replace(/\//g, ".")}`;
    return {
      id: label,
      label,
      matchKeys: unique([label, `jsp:${relative.replace(/\//g, ".")}`, normalized])
    };
  }

  const candidate = packageName ?? parentPackage(pathOrClass) ?? pathOrClass;
  const normalized = normalizePackage(candidate);
  if (!normalized) {
    return { id: "pkg:unknown", label: "pkg:unknown", matchKeys: ["pkg:unknown"] };
  }

  if (normalized.startsWith("java.")) {
    return { id: "ext:java", label: "java.*", matchKeys: ["java.*", normalized] };
  }
  if (normalized.startsWith("jdk.")) {
    return { id: "ext:jdk", label: "jdk.*", matchKeys: ["jdk.*", normalized] };
  }
  if (normalized.startsWith("javax.")) {
    return { id: "ext:javax", label: "javax.*", matchKeys: ["javax.*", normalized] };
  }
  if (normalized.startsWith("jakarta.")) {
    return { id: "ext:jakarta", label: "jakarta.*", matchKeys: ["jakarta.*", normalized] };
  }
  if (normalized.startsWith("org.springframework.")) {
    return {
      id: "ext:org.springframework",
      label: "org.springframework.*",
      matchKeys: ["org.springframework.*", normalized]
    };
  }

  const segments = normalized.split(".").filter(Boolean);
  const keywords = new Set(["web", "service", "repository", "dao", "common", "util", "model", "controller", "action"]);
  const keywordIndex = segments.findIndex((entry) => keywords.has(entry));
  const end = keywordIndex >= 0 ? Math.min(segments.length, keywordIndex + 2) : Math.min(segments.length, 4);
  const prefix = segments.slice(0, Math.max(1, end)).join(".");
  return {
    id: `pkg:${prefix}`,
    label: `${prefix}.*`,
    matchKeys: unique([`${prefix}.*`, prefix, normalized])
  };
}

function normalizePackage(value: string): string {
  if (value.includes("/")) {
    const normalized = normalizePath(value);
    if (normalized.endsWith(".java")) {
      const mainMarker = "/src/main/java/";
      const testMarker = "/src/test/java/";
      const marker = normalized.includes(mainMarker) ? mainMarker : normalized.includes(testMarker) ? testMarker : "/";
      return normalizePath(normalized.split(marker).at(-1) ?? normalized).replace(/\.java$/, "").replace(/\//g, ".");
    }
    return normalized.replace(/\//g, ".");
  }
  return value;
}

function parentPackage(value: string): string | undefined {
  const normalized = normalizePackage(value);
  if (!normalized.includes(".")) {
    return undefined;
  }
  return normalized.split(".").slice(0, -1).join(".");
}

function inferNodeTypeFromId(nodeId: string): GraphNodeType {
  if (nodeId.endsWith(".jsp")) {
    return "jsp";
  }
  if (nodeId.endsWith(".java")) {
    return "java";
  }
  return "unresolved";
}

function createEmptyZone(id: string, label: string): RawZoneRecord {
  return {
    id,
    label,
    nodeKinds: [],
    nodeCount: 0,
    packageCount: 0,
    classCount: 0,
    methodCount: 0,
    entryCoverage: 0,
    fanIn: 0,
    fanOut: 0,
    topClasses: [],
    edgeBreakdown: {},
    representativePath: [],
    action: "EXPAND",
    traces: [],
    hiddenNodeCount: 0,
    visibleNodeCount: 0,
    matchKeys: [label, id],
    nodeIds: [],
    rawEdgeCount: 0,
    reachableEntries: []
  };
}

function createEntryReachSets(
  entries: DashboardEntry[],
  entryDependencyIndex: DashboardEntryDependencyIndex,
  adjacency: Map<string, DashboardGraphEdge[]>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  if (entryDependencyIndex.entries.length > 0) {
    for (const entry of entryDependencyIndex.entries) {
      result.set(normalizePath(entry.entry), new Set(entry.reachableFiles.map((value) => normalizePath(value))));
    }
    return result;
  }

  for (const entry of entries) {
    result.set(entry.id, breadthFirstReach(entry.id, adjacency));
  }
  return result;
}

function breadthFirstReach(
  start: string,
  adjacency: Map<string, DashboardGraphEdge[]>
): Set<string> {
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  return visited;
}

function enrichRepresentativePaths(
  snapshot: LoadedDashboardSnapshot,
  entryReachSets: Map<string, Set<string>>
): void {
  const entryIds = snapshot.entries.map((entry) => entry.id);
  for (const zone of snapshot.zones) {
    let representativePath: string[] = [];
    for (const entryId of entryIds) {
      const reachable = entryReachSets.get(entryId);
      if (!reachable) {
        continue;
      }
      const targetIds = zone.nodeIds.filter((nodeId: string) => reachable.has(nodeId));
      if (targetIds.length === 0) {
        continue;
      }
      representativePath = findPath(entryId, new Set(targetIds), snapshot.adjacency);
      if (representativePath.length > 0) {
        break;
      }
    }
    zone.representativePath = representativePath;
  }
}

function findPath(
  start: string,
  targets: Set<string>,
  adjacency: Map<string, DashboardGraphEdge[]>
): string[] {
  const queue = [start];
  const previous = new Map<string, string | undefined>([[start, undefined]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (targets.has(current)) {
      const pathValues: string[] = [];
      let cursor: string | undefined = current;
      while (cursor) {
        pathValues.push(cursor);
        cursor = previous.get(cursor);
      }
      return pathValues.reverse();
    }
    for (const edge of adjacency.get(current) ?? []) {
      if (previous.has(edge.to)) {
        continue;
      }
      previous.set(edge.to, current);
      queue.push(edge.to);
    }
  }
  return [];
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

function pushSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key) ?? new Set<string>();
  existing.add(value);
  map.set(key, existing);
}

function takeTopClassNames(existing: string[], next: string[]): string[] {
  return sortStrings(unique([...existing, ...next])).slice(0, 5);
}

function snapshotNodePackage(node: RawNodeRecord | undefined): string | undefined {
  return node?.packageName;
}
