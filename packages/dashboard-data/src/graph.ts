import { GraphConfidence, GraphEdgeType } from "@leflect-java/schema";

import { readPolicies } from "./policies";
import { LoadedDashboardSnapshot, RawNodeRecord, RawZoneRecord } from "./snapshot";
import {
  DashboardAction,
  DashboardManualOverride,
  DashboardMatrix,
  DashboardNodeDetail,
  DashboardNodeSummary,
  DashboardPolicy,
  DashboardPolicyRule,
  DashboardPolicyScope,
  DashboardPolicyTrace,
  DashboardVisibleEdge,
  DashboardVisibleGraphRequest,
  DashboardVisibleGraphResponse,
  DashboardZoneSummary,
  DashboardGraphEdge
} from "./types";
import { globToRegExp, normalizePath, shallowClone, simpleName, sortStrings, unique } from "./util";

const GRAPH_EDGE_TYPES: GraphEdgeType[] = ["JAVA_CALL", "JSP_SCRIPTLET_CALL", "JSP_USES_TAG"];
const visibleGraphCache = new Map<string, DashboardVisibleGraphResponse>();

export async function buildVisibleGraph(
  snapshot: LoadedDashboardSnapshot,
  request: DashboardVisibleGraphRequest = {}
): Promise<DashboardVisibleGraphResponse> {
  const policies = await readPolicies(snapshot.context);
  return buildVisibleGraphWithPolicies(snapshot, policies, request);
}

export function buildVisibleGraphWithPolicies(
  snapshot: LoadedDashboardSnapshot,
  policies: DashboardPolicy[],
  request: DashboardVisibleGraphRequest = {}
): DashboardVisibleGraphResponse {
  const startedAt = Date.now();
  const cacheKey = JSON.stringify({
    analysisOut: snapshot.context.analysisOut,
    generatedAt: snapshot.summary.generatedAt,
    policies: policies.map((entry) => `${entry.id}:${entry.updatedAt}:${entry.enabled}:${entry.priority}`),
    request
  });
  const cached = visibleGraphCache.get(cacheKey);
  if (cached) {
    return {
      ...shallowClone(cached),
      stats: {
        ...cached.stats,
        cacheHit: true
      }
    };
  }

  const entryId = normalizePath(request.entryId ?? snapshot.defaultEntryId ?? "");
  const allowedEdgeTypes = new Set(request.filters?.edgeTypes?.length ? request.filters.edgeTypes : GRAPH_EDGE_TYPES);
  const traversal = traverseGraph(snapshot, entryId, request.filters?.maxDepth ?? 4, allowedEdgeTypes);
  let rawNodeIds = traversal.order;
  if (!entryId) {
    rawNodeIds = snapshot.nodes.map((entry) => entry.id);
  }

  rawNodeIds = applyNodeFilters(snapshot, rawNodeIds, request, entryId);
  const rawNodeSet = new Set(rawNodeIds);
  const rawEdges = snapshot.fileEdges.filter(
    (edge) =>
      rawNodeSet.has(edge.from) &&
      rawNodeSet.has(edge.to) &&
      allowedEdgeTypes.has(edge.type)
  );

  const activePolicies = resolveActivePolicies(policies, request.activePolicyIds);
  const zoneStates = resolveZoneStates(snapshot, rawNodeIds, traversal.depths, activePolicies, entryId, request.manualOverrides ?? []);
  const visibleNodeMap = new Map<string, DashboardNodeSummary>();
  const visibleEdgeMap = new Map<string, DashboardVisibleEdge>();
  let hiddenNodeCount = 0;

  for (const rawNodeId of rawNodeIds) {
    const rawNode = snapshot.nodesById.get(rawNodeId);
    if (!rawNode) {
      continue;
    }
    const state = zoneStates.get(rawNode.zoneId);
    const action = rawNode.id === entryId ? "EXPAND" : state?.action ?? "EXPAND";
    const visibleId = rawNode.id === entryId ? rawNode.id : resolveVisibleNodeId(rawNode, action);
    if (!visibleId) {
      hiddenNodeCount += 1;
      continue;
    }

    if (visibleId.startsWith("zone:")) {
      if (!visibleNodeMap.has(visibleId)) {
        visibleNodeMap.set(visibleId, createVisibleZoneNode(rawNode.zoneId, state));
      }
      continue;
    }

    visibleNodeMap.set(visibleId, {
      ...rawNode,
      isEntry: rawNode.id === entryId,
      action,
      collapsed: false,
      summarized: false,
      hidden: false,
      kind: rawNode.kind,
      nodeType: rawNode.nodeType
    });
  }

  for (const edge of rawEdges) {
    const sourceNode = snapshot.nodesById.get(edge.from);
    const targetNode = snapshot.nodesById.get(edge.to);
    if (!sourceNode || !targetNode) {
      continue;
    }
    const sourceAction = edge.from === entryId ? "EXPAND" : zoneStates.get(sourceNode.zoneId)?.action ?? "EXPAND";
    const targetAction = edge.to === entryId ? "EXPAND" : zoneStates.get(targetNode.zoneId)?.action ?? "EXPAND";
    const sourceVisibleId = edge.from === entryId ? edge.from : resolveVisibleNodeId(sourceNode, sourceAction);
    const targetVisibleId = edge.to === entryId ? edge.to : resolveVisibleNodeId(targetNode, targetAction);
    if (!sourceVisibleId || !targetVisibleId) {
      continue;
    }

    const edgeId = `${sourceVisibleId}->${targetVisibleId}`;
    const existing = visibleEdgeMap.get(edgeId);
    const symbols = unique([
      ...(existing?.symbols ?? []),
      edge.fromSymbol ?? "",
      edge.toSymbol ?? ""
    ].filter(Boolean));
    const edgeTypes = unique([...(existing?.edgeTypes ?? []), edge.type]);
    visibleEdgeMap.set(edgeId, {
      id: edgeId,
      source: sourceVisibleId,
      target: targetVisibleId,
      count: (existing?.count ?? 0) + 1,
      edgeTypes,
      symbols,
      confidence: chooseConfidence(existing?.confidence, edge.confidence)
    });
  }

  if (request.filters?.cycleOnly) {
    const cycleNodeIds = new Set(flattenCycles(computeCycles([...visibleNodeMap.keys()], [...visibleEdgeMap.values()])));
    for (const [nodeId] of visibleNodeMap) {
      if (!cycleNodeIds.has(nodeId)) {
        visibleNodeMap.delete(nodeId);
      }
    }
    for (const [edgeId, edge] of visibleEdgeMap) {
      if (!cycleNodeIds.has(edge.source) || !cycleNodeIds.has(edge.target)) {
        visibleEdgeMap.delete(edgeId);
      }
    }
  }

  const visibleNodes = [...visibleNodeMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  const visibleEdges = [...visibleEdgeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  const visibleNodeIds = new Set(visibleNodes.map((entry) => entry.id));
  const zones = buildVisibleZones(snapshot, zoneStates, visibleNodeIds, rawNodeIds);
  const response: DashboardVisibleGraphResponse = {
    generatedAt: new Date().toISOString(),
    entryId: entryId || undefined,
    nodes: visibleNodes,
    edges: visibleEdges,
    zones,
    stats: {
      rawNodeCount: rawNodeIds.length,
      rawEdgeCount: rawEdges.length,
      visibleNodeCount: visibleNodes.length,
      visibleEdgeCount: visibleEdges.length,
      hiddenNodeCount,
      collapsedZoneCount: zones.filter((zone) => zone.action === "COLLAPSE").length,
      summarizedZoneCount: zones.filter((zone) => zone.action === "SUMMARIZE").length,
      renderTimeMs: Date.now() - startedAt,
      cacheHit: false
    },
    matrix: buildMatrix(snapshot, visibleNodes, visibleEdges),
    impact: entryId ? buildImpact(snapshot, entryId, rawNodeSet) : undefined,
    cycles: computeCycles(visibleNodes.map((entry) => entry.id), visibleEdges),
    policyTrace: zones.flatMap((zone) => zone.traces).sort(compareTrace)
  };

  visibleGraphCache.set(cacheKey, shallowClone(response));
  return response;
}

export async function getDashboardBootstrap(snapshot: LoadedDashboardSnapshot) {
  const policies = await readPolicies(snapshot.context);
  const defaultVisibleGraph = buildVisibleGraphWithPolicies(snapshot, policies, {
    entryId: snapshot.defaultEntryId,
    activePolicyIds: policies.filter((entry) => entry.enabled).map((entry) => entry.id),
    filters: { maxDepth: 4 }
  });

  return {
    projectName: snapshot.context.projectName ?? snapshot.context.root.split("/").at(-1) ?? "LeflectJava",
    root: snapshot.context.root,
    analysisOut: snapshot.context.analysisOut,
    configPath: snapshot.context.configPath,
    generatedAt: new Date().toISOString(),
    summary: snapshot.summary,
    unresolved: snapshot.unresolved,
    labels: snapshot.labels,
    entries: snapshot.entries,
    policies,
    zones: defaultVisibleGraph.zones,
    defaultEntryId: snapshot.defaultEntryId,
    defaultVisibleGraph,
    diagnostics: snapshot.unresolved.diagnostics
  };
}

export function getNodeDetail(snapshot: LoadedDashboardSnapshot, nodeId: string): DashboardNodeDetail | undefined {
  const normalizedNodeId = normalizePath(nodeId);
  const node = snapshot.nodesById.get(normalizedNodeId);
  if (!node) {
    return undefined;
  }
  const incoming = node.referencedBy.map((entry) => ({
    source: entry.path,
    edgeTypes: entry.edgeTypes,
    symbols: entry.symbols
  }));
  const outgoing = node.references.map((entry) => ({
    target: entry.path,
    edgeTypes: entry.edgeTypes,
    symbols: entry.symbols
  }));
  const representativeReferences = [
    ...snapshot.javaMethodCalls
      .filter((entry) => normalizePath(entry.fromFile ?? "") === normalizedNodeId)
      .slice(0, 10)
      .map((entry) => ({
        source: entry.fromFile ?? normalizedNodeId,
        target: entry.toFile ?? entry.classPath ?? entry.to ?? "unresolved",
        methodName: entry.methodName,
        classPath: entry.classPath,
        responseType: entry.responseType,
        location: entry.location,
        snippet: entry.snippet
      })),
    ...snapshot.jspMethodCalls
      .filter((entry) => normalizePath(entry.file) === normalizedNodeId)
      .slice(0, 10)
      .map((entry) => ({
        source: entry.file,
        target: entry.classPath ?? entry.qualifier ?? entry.methodName,
        methodName: entry.methodName,
        classPath: entry.classPath,
        responseType: entry.responseType,
        location: entry.location,
        snippet: entry.snippet
      }))
  ].slice(0, 10);

  return {
    node,
    incoming,
    outgoing,
    representativeReferences
  };
}

export async function getZoneSummary(
  snapshot: LoadedDashboardSnapshot,
  zoneId: string,
  request: DashboardVisibleGraphRequest = {}
): Promise<DashboardZoneSummary | undefined> {
  const policies = await readPolicies(snapshot.context);
  const visible = buildVisibleGraphWithPolicies(snapshot, policies, request);
  const normalizedZoneId = normalizeZoneId(zoneId);
  return visible.zones.find((entry) => entry.id === normalizedZoneId);
}

function resolveActivePolicies(
  policies: DashboardPolicy[],
  activePolicyIds: string[] | undefined
): DashboardPolicy[] {
  const activeSet = activePolicyIds && activePolicyIds.length > 0 ? new Set(activePolicyIds) : undefined;
  return policies
    .filter((entry) => (activeSet ? activeSet.has(entry.id) : entry.enabled))
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
}

type ZoneState = {
  zone: RawZoneRecord;
  action: DashboardAction;
  traces: DashboardPolicyTrace[];
  winner?: DashboardPolicyTrace;
};

function resolveZoneStates(
  snapshot: LoadedDashboardSnapshot,
  rawNodeIds: string[],
  depths: Map<string, number>,
  policies: DashboardPolicy[],
  entryId: string,
  manualOverrides: DashboardManualOverride[]
): Map<string, ZoneState> {
  const rawZoneIds = unique(
    rawNodeIds
      .map((nodeId) => snapshot.nodesById.get(nodeId)?.zoneId)
      .filter((entry): entry is string => Boolean(entry))
  );
  const overrideMap = new Map(manualOverrides.map((entry) => [normalizeZoneId(entry.zoneId), entry.action]));
  const result = new Map<string, ZoneState>();

  for (const zoneId of rawZoneIds) {
    const zone = snapshot.zonesById.get(zoneId);
    if (!zone) {
      continue;
    }
    const traces = resolvePolicyTrace(zone, depths, policies, entryId, overrideMap.get(zone.id));
    const winner = traces.find((entry) => !entry.overridden);
    result.set(zone.id, {
      zone,
      action: winner?.action ?? "EXPAND",
      traces,
      winner
    });
  }

  return result;
}

function resolvePolicyTrace(
  zone: RawZoneRecord,
  depths: Map<string, number>,
  policies: DashboardPolicy[],
  entryId: string,
  manualOverride: DashboardAction | undefined
): DashboardPolicyTrace[] {
  if (manualOverride) {
    return [
      {
        policyId: "manual-override",
        policyName: "Manual Override",
        ruleId: `manual:${zone.id}`,
        ruleName: `Manual ${manualOverride}`,
        action: manualOverride,
        specificity: Number.MAX_SAFE_INTEGER,
        policyPriority: Number.MAX_SAFE_INTEGER,
        rulePriority: Number.MAX_SAFE_INTEGER,
        scope: "SESSION",
        overridden: false
      }
    ];
  }

  const traces: DashboardPolicyTrace[] = [];
  for (const policy of policies) {
    if (!policy.enabled || !matchesPolicyScope(policy, entryId)) {
      continue;
    }
    for (const rule of policy.rules) {
      if (!rule.enabled || !matchesRule(zone, depths, entryId, rule)) {
        continue;
      }
      traces.push({
        policyId: policy.id,
        policyName: policy.name,
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action.type,
        specificity: computeSpecificity(zone, rule),
        policyPriority: policy.priority,
        rulePriority: rule.priority,
        scope: policy.scope,
        overridden: false
      });
    }
  }

  traces.sort(compareTrace);
  if (traces.length > 0) {
    traces.forEach((entry, index) => {
      entry.overridden = index !== 0;
    });
  }
  return traces;
}

function matchesPolicyScope(policy: DashboardPolicy, entryId: string): boolean {
  if (policy.scope !== "ENTRYPOINT") {
    return true;
  }
  if (!policy.scopeValue || policy.scopeValue === "*") {
    return true;
  }
  return globToRegExp(policy.scopeValue).test(entryId);
}

function matchesRule(
  zone: RawZoneRecord,
  depths: Map<string, number>,
  entryId: string,
  rule: DashboardPolicyRule
): boolean {
  const match = rule.match;
  if (!match) {
    return true;
  }
  if (match.zonePatterns && match.zonePatterns.length > 0) {
    const zoneMatched = match.zonePatterns.some((pattern) => {
      const regex = globToRegExp(pattern);
      return zone.matchKeys.some((key: string) => regex.test(key));
    });
    if (!zoneMatched) {
      return false;
    }
  }

  if (match.entryPatterns && match.entryPatterns.length > 0) {
    const entryMatched = match.entryPatterns.some((pattern) => globToRegExp(pattern).test(entryId));
    if (!entryMatched) {
      return false;
    }
  }

  if (match.nodeKinds && match.nodeKinds.length > 0) {
    if (!zone.nodeKinds.some((nodeKind: RawZoneRecord["nodeKinds"][number]) => match.nodeKinds?.includes(nodeKind))) {
      return false;
    }
  }

  const minDepth = Math.min(
    ...zone.nodeIds.map((nodeId: string) => depths.get(nodeId) ?? Number.MAX_SAFE_INTEGER)
  );
  if (match.minDepth !== undefined && minDepth < match.minDepth) {
    return false;
  }
  if (match.maxDepth !== undefined && minDepth > match.maxDepth) {
    return false;
  }
  if (match.minEntryCoverage !== undefined && zone.entryCoverage < match.minEntryCoverage) {
    return false;
  }
  if (match.maxEntryCoverage !== undefined && zone.entryCoverage > match.maxEntryCoverage) {
    return false;
  }
  if (match.minFanIn !== undefined && zone.fanIn < match.minFanIn) {
    return false;
  }
  if (match.maxFanIn !== undefined && zone.fanIn > match.maxFanIn) {
    return false;
  }
  if (match.minFanOut !== undefined && zone.fanOut < match.minFanOut) {
    return false;
  }
  if (match.maxFanOut !== undefined && zone.fanOut > match.maxFanOut) {
    return false;
  }
  if (match.edgeKinds && match.edgeKinds.length > 0) {
    const edgeKinds = Object.keys(zone.edgeBreakdown) as GraphEdgeType[];
    if (!edgeKinds.some((edgeKind) => match.edgeKinds?.includes(edgeKind))) {
      return false;
    }
  }

  return true;
}

function computeSpecificity(zone: RawZoneRecord, rule: DashboardPolicyRule): number {
  const patterns = rule.match?.zonePatterns ?? [];
  const matchedLength = patterns.reduce((max, pattern) => {
    const regex = globToRegExp(pattern);
    return zone.matchKeys.some((key: string) => regex.test(key)) ? Math.max(max, pattern.length) : max;
  }, 0);
  const conditionCount = Object.values(rule.match ?? {}).filter((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== undefined;
  }).length;
  return matchedLength * 10 + conditionCount;
}

function compareTrace(left: DashboardPolicyTrace, right: DashboardPolicyTrace): number {
  return (
    scopeRank(right.scope) - scopeRank(left.scope) ||
    right.specificity - left.specificity ||
    right.policyPriority - left.policyPriority ||
    right.rulePriority - left.rulePriority ||
    right.ruleId.localeCompare(left.ruleId)
  );
}

function scopeRank(scope: DashboardPolicyScope): number {
  switch (scope) {
    case "SESSION":
      return 5;
    case "ENTRYPOINT":
      return 4;
    case "PROJECT":
      return 3;
    case "GLOBAL":
      return 2;
  }
}

function resolveVisibleNodeId(node: RawNodeRecord, action: DashboardAction): string | undefined {
  switch (action) {
    case "HIDE":
      return undefined;
    case "COLLAPSE":
    case "SUMMARIZE":
      return `zone:${node.zoneId}`;
    case "EXPAND":
      return node.id;
  }
}

function createVisibleZoneNode(zoneId: string, state: ZoneState | undefined): DashboardNodeSummary {
  const zone = state?.zone;
  return {
    id: `zone:${zoneId}`,
    label: zone?.label ?? zoneId,
    kind: "zone",
    nodeType: "zone",
    zoneId,
    labels: [],
    isEntry: false,
    incomingCount: zone?.fanIn ?? 0,
    outgoingCount: zone?.fanOut ?? 0,
    collapsed: state?.action === "COLLAPSE",
    summarized: state?.action === "SUMMARIZE",
    hidden: false,
    hiddenChildrenCount: zone?.nodeCount ?? 0,
    classCount: zone?.classCount ?? 0,
    methodCount: zone?.methodCount ?? 0,
    packageCount: zone?.packageCount ?? 0,
    representativeClasses: zone?.topClasses ?? [],
    action: state?.action
  };
}

function buildVisibleZones(
  snapshot: LoadedDashboardSnapshot,
  zoneStates: Map<string, ZoneState>,
  visibleNodeIds: Set<string>,
  rawNodeIds: string[]
): DashboardZoneSummary[] {
  const rawNodeSet = new Set(rawNodeIds);
  const zones: DashboardZoneSummary[] = [];
  for (const [zoneId, state] of zoneStates) {
    const zone = state.zone;
    const visibleCount = zone.nodeIds.filter(
      (nodeId: string) => visibleNodeIds.has(nodeId) || visibleNodeIds.has(`zone:${zoneId}`)
    ).length;
    const hiddenCount = zone.nodeIds.filter((nodeId: string) => rawNodeSet.has(nodeId)).length - visibleCount;
    zones.push({
      ...zone,
      action: state.action,
      winnerPolicyId: state.winner?.policyId,
      winnerPolicyName: state.winner?.policyName,
      winnerRuleId: state.winner?.ruleId,
      winnerRuleName: state.winner?.ruleName,
      traces: state.traces,
      hiddenNodeCount: Math.max(hiddenCount, 0),
      visibleNodeCount: Math.max(visibleCount, state.action === "EXPAND" ? visibleCount : visibleCount > 0 ? 1 : 0)
    });
  }
  return zones.sort((left, right) => left.label.localeCompare(right.label));
}

function buildMatrix(
  snapshot: LoadedDashboardSnapshot,
  nodes: DashboardNodeSummary[],
  edges: DashboardVisibleEdge[]
): DashboardMatrix {
  const nodeZoneLookup = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "zone") {
      nodeZoneLookup.set(node.id, node.label);
      continue;
    }
    const zoneLabel = snapshot.zonesById.get(node.zoneId)?.label ?? node.zoneId;
    nodeZoneLookup.set(node.id, zoneLabel);
  }
  const labels = sortStrings(unique([...nodeZoneLookup.values()]));
  const values: Record<string, number> = {};
  for (const edge of edges) {
    const row = nodeZoneLookup.get(edge.source) ?? simpleName(edge.source) ?? edge.source;
    const column = nodeZoneLookup.get(edge.target) ?? simpleName(edge.target) ?? edge.target;
    values[`${row}::${column}`] = (values[`${row}::${column}`] ?? 0) + edge.count;
  }
  return {
    rows: labels,
    columns: labels,
    values
  };
}

function buildImpact(
  snapshot: LoadedDashboardSnapshot,
  entryId: string,
  allowedNodes: Set<string>
) {
  const forward = traverseFrom(entryId, snapshot.adjacency, allowedNodes);
  const reverse = traverseFrom(entryId, snapshot.reverseAdjacency, allowedNodes, "from");
  return {
    nodeId: entryId,
    forwardCount: Math.max(forward.size - 1, 0),
    reverseCount: Math.max(reverse.size - 1, 0),
    forwardNodes: [...forward].filter((entry) => entry !== entryId).slice(0, 50),
    reverseNodes: [...reverse].filter((entry) => entry !== entryId).slice(0, 50)
  };
}

function traverseFrom(
  start: string,
  adjacency: Map<string, DashboardGraphEdge[]>,
  allowedNodes: Set<string>,
  direction: "to" | "from" = "to"
): Set<string> {
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current) || !allowedNodes.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      const next = direction === "to" ? edge.to : edge.from;
      if (!visited.has(next) && allowedNodes.has(next)) {
        queue.push(next);
      }
    }
  }
  return visited;
}

function computeCycles(nodeIds: string[], edges: DashboardVisibleEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Set<string>());
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
  }

  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const cycles: Array<{ id: string; size: number; nodes: string[] }> = [];
  let index = 0;

  for (const nodeId of nodeIds) {
    if (!indexes.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return cycles.sort((left, right) => right.size - left.size || left.id.localeCompare(right.id));

  function strongConnect(nodeId: string): void {
    indexes.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!indexes.has(next)) {
        strongConnect(next);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, lowLinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, indexes.get(next) ?? 0));
      }
    }

    if (lowLinks.get(nodeId) !== indexes.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    let next: string | undefined;
    do {
      next = stack.pop();
      if (!next) {
        break;
      }
      onStack.delete(next);
      component.push(next);
    } while (next !== nodeId);

    const hasSelfLoop = adjacency.get(nodeId)?.has(nodeId) ?? false;
    if (component.length > 1 || hasSelfLoop) {
      cycles.push({
        id: `cycle:${component.slice().sort().join("|")}`,
        size: component.length,
        nodes: component.sort((left, right) => left.localeCompare(right))
      });
    }
  }
}

function flattenCycles(cycles: Array<{ nodes: string[] }>): string[] {
  return cycles.flatMap((entry) => entry.nodes);
}

function applyNodeFilters(
  snapshot: LoadedDashboardSnapshot,
  rawNodeIds: string[],
  request: DashboardVisibleGraphRequest,
  entryId: string
): string[] {
  let result = [...rawNodeIds];
  if (request.filters?.sharedNodesOnly) {
    result = result.filter((nodeId) => (snapshot.nodesById.get(nodeId)?.incomingCount ?? 0) > 1 || nodeId === entryId);
  }
  if (request.filters?.entrySpecificOnly) {
    result = result.filter((nodeId) => {
      const zone = snapshot.zonesById.get(snapshot.nodesById.get(nodeId)?.zoneId ?? "");
      return (zone?.entryCoverage ?? 1) <= 0.5 || nodeId === entryId;
    });
  }
  const search = request.filters?.search?.trim().toLowerCase();
  if (search) {
    result = result.filter((nodeId) => {
      const node = snapshot.nodesById.get(nodeId);
      if (!node) {
        return false;
      }
      return [node.label, node.path, node.classId, node.packageName, node.zoneLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }
  return unique(result);
}

function traverseGraph(
  snapshot: LoadedDashboardSnapshot,
  entryId: string,
  maxDepth: number,
  allowedEdgeTypes: Set<GraphEdgeType>
): {
  order: string[];
  depths: Map<string, number>;
} {
  if (!entryId) {
    return {
      order: snapshot.nodes.map((entry) => entry.id),
      depths: new Map(snapshot.nodes.map((entry) => [entry.id, 0]))
    };
  }

  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: entryId, depth: 0 }];
  const visited = new Set<string>();
  const depths = new Map<string, number>();
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);
    depths.set(current.nodeId, current.depth);
    order.push(current.nodeId);

    if (current.depth >= maxDepth) {
      continue;
    }

    for (const edge of snapshot.adjacency.get(current.nodeId) ?? []) {
      if (!allowedEdgeTypes.has(edge.type) || visited.has(edge.to)) {
        continue;
      }
      queue.push({ nodeId: edge.to, depth: current.depth + 1 });
    }
  }

  return { order, depths };
}

function normalizeZoneId(zoneId: string): string {
  return zoneId.startsWith("zone:") ? zoneId.slice("zone:".length) : zoneId;
}

function chooseConfidence(
  left: GraphConfidence | undefined,
  right: GraphConfidence
): GraphConfidence {
  if (!left) {
    return right;
  }
  const priority: Record<GraphConfidence, number> = {
    unresolved: 0,
    low: 1,
    medium: 2,
    high: 3
  };
  return priority[right] > priority[left] ? right : left;
}
