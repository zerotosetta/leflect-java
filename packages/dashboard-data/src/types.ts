import {
  DiagnosticRecord,
  GraphConfidence,
  GraphEdgeType,
  GraphNodeType,
  LabelsIndex,
  SummaryReport,
  UnresolvedReport
} from "@leflect-java/schema";

export type DashboardContext = {
  root: string;
  analysisOut: string;
  configPath?: string;
  projectName?: string;
};

export type DashboardClassRecord = {
  id: string;
  name: string;
  file?: string;
  packageName?: string;
  sourceKind?: string;
  kind?: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
  location?: SourceLocation;
};

export type DashboardMethodRecord = {
  id: string;
  name: string;
  classId?: string;
  file?: string;
  returnType?: string;
  parameters?: string[];
  location?: SourceLocation;
};

export type DashboardJspRecord = {
  path: string;
  directives?: unknown[];
  imports?: string[];
  includes?: string[];
  taglibs?: Array<{ prefix: string; uri: string; location?: SourceLocation }>;
  tags?: Array<{ prefix: string; name: string; raw: string; location?: SourceLocation }>;
  scriptlets?: Array<{ kind: string; code: string; location?: SourceLocation }>;
  ast?: {
    mode: "jasper" | "lightweight";
    astPath?: string;
  };
  resolvedTags?: Array<{
    prefix: string;
    name: string;
    uri?: string;
    handlerClass?: string;
  }>;
};

export type DashboardFileDependency = {
  path: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  referenceCount: number;
  dependantCount: number;
  references: Array<{
    path: string;
    nodeType: GraphNodeType;
    edgeTypes: GraphEdgeType[];
    symbols: string[];
  }>;
  referencedBy: Array<{
    path: string;
    nodeType: GraphNodeType;
    edgeTypes: GraphEdgeType[];
    symbols: string[];
  }>;
};

export type DashboardFileDependencyIndex = {
  schemaVersion: string;
  generatedAt: string;
  files: DashboardFileDependency[];
};

export type DashboardEntryDependencyRecord = {
  entry: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  matchedBy: string[];
  nodeCount: number;
  edgeCount: number;
  reachableFiles: string[];
  edges: DashboardGraphEdge[];
};

export type DashboardEntryDependencyIndex = {
  schemaVersion: string;
  generatedAt: string;
  patterns: {
    java: string[];
    jsp: string[];
  };
  matchedEntries: Array<{
    path: string;
    nodeType: Exclude<GraphNodeType, "unresolved">;
    matchedBy: string[];
  }>;
  unmatchedPatterns: Array<{
    nodeType: Exclude<GraphNodeType, "unresolved">;
    pattern: string;
  }>;
  entries: DashboardEntryDependencyRecord[];
};

export type DashboardGraphEdge = {
  from: string;
  to: string;
  type: GraphEdgeType;
  confidence: GraphConfidence;
  fromFile?: string;
  toFile?: string;
  fromSymbol?: string;
  toSymbol?: string;
};

export type DashboardJavaMethodCall = {
  from?: string;
  to?: string;
  fromClassId?: string;
  toClassId?: string;
  fromMethodId?: string;
  toMethodId?: string;
  fromFile?: string;
  toFile?: string;
  rawTarget?: string;
  methodName?: string;
  classPath?: string;
  importId?: string;
  inputParameters?: Array<{ index: number; type?: string; value?: string }>;
  responseType?: string;
  location?: SourceLocation;
  snippet?: string;
};

export type DashboardJspMethodCall = {
  file: string;
  methodName: string;
  methodId?: string;
  qualifier?: string;
  classPath?: string;
  importId?: string;
  inputParameters?: Array<{ index: number; type?: string; value?: string }>;
  responseType?: string;
  location?: SourceLocation;
  snippet?: string;
};

export type SourceLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type DashboardEntryType = "jsp" | "controller" | "action" | "service";

export type DashboardEntry = {
  id: string;
  type: DashboardEntryType;
  label: string;
  path: string;
  classId?: string;
  packageName?: string;
  matchedBy: string[];
};

export type DashboardPolicyScope = "GLOBAL" | "PROJECT" | "ENTRYPOINT" | "SESSION";
export type DashboardAction = "EXPAND" | "COLLAPSE" | "SUMMARIZE" | "HIDE";

export type DashboardPolicyRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  terminal?: boolean;
  match?: {
    zonePatterns?: string[];
    entryPatterns?: string[];
    nodeKinds?: GraphNodeType[];
    edgeKinds?: GraphEdgeType[];
    minDepth?: number;
    maxDepth?: number;
    minEntryCoverage?: number;
    maxEntryCoverage?: number;
    minFanIn?: number;
    maxFanIn?: number;
    minFanOut?: number;
    maxFanOut?: number;
  };
  action: {
    type: DashboardAction;
    aggregateEdges?: boolean;
    keepTopKNodes?: number;
    visibleEdgeTypes?: GraphEdgeType[];
  };
  updatedAt: string;
};

export type DashboardPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  scope: DashboardPolicyScope;
  scopeValue?: string;
  conflictStrategy: "MOST_SPECIFIC_WINS";
  rules: DashboardPolicyRule[];
  updatedAt: string;
};

export type DashboardPolicyStore = {
  schemaVersion: string;
  generatedAt: string;
  policies: DashboardPolicy[];
};

export type DashboardManualOverride = {
  zoneId: string;
  action: DashboardAction;
};

export type DashboardVisibleGraphRequest = {
  entryId?: string;
  activePolicyIds?: string[];
  filters?: {
    edgeTypes?: GraphEdgeType[];
    maxDepth?: number;
    includeHidden?: boolean;
    sharedNodesOnly?: boolean;
    entrySpecificOnly?: boolean;
    cycleOnly?: boolean;
    search?: string;
  };
  manualOverrides?: DashboardManualOverride[];
};

export type DashboardPolicyTrace = {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: DashboardAction;
  specificity: number;
  policyPriority: number;
  rulePriority: number;
  scope: DashboardPolicyScope;
  overridden: boolean;
};

export type DashboardZoneSummary = {
  id: string;
  label: string;
  nodeKinds: GraphNodeType[];
  nodeCount: number;
  packageCount: number;
  classCount: number;
  methodCount: number;
  entryCoverage: number;
  fanIn: number;
  fanOut: number;
  topClasses: string[];
  edgeBreakdown: Partial<Record<GraphEdgeType, number>>;
  representativePath: string[];
  action: DashboardAction;
  winnerPolicyId?: string;
  winnerPolicyName?: string;
  winnerRuleId?: string;
  winnerRuleName?: string;
  traces: DashboardPolicyTrace[];
  hiddenNodeCount: number;
  visibleNodeCount: number;
};

export type DashboardNodeSummary = {
  id: string;
  label: string;
  kind: "file" | "external" | "zone";
  nodeType: GraphNodeType | "zone";
  path?: string;
  zoneId: string;
  classId?: string;
  packageName?: string;
  labels: string[];
  isEntry: boolean;
  incomingCount: number;
  outgoingCount: number;
  collapsed: boolean;
  summarized: boolean;
  hidden: boolean;
  hiddenChildrenCount?: number;
  classCount?: number;
  methodCount?: number;
  packageCount?: number;
  representativeClasses?: string[];
  action?: DashboardAction;
};

export type DashboardVisibleEdge = {
  id: string;
  source: string;
  target: string;
  count: number;
  edgeTypes: GraphEdgeType[];
  symbols: string[];
  confidence: GraphConfidence;
};

export type DashboardMatrix = {
  rows: string[];
  columns: string[];
  values: Record<string, number>;
};

export type DashboardImpactSummary = {
  nodeId: string;
  forwardCount: number;
  reverseCount: number;
  forwardNodes: string[];
  reverseNodes: string[];
};

export type DashboardCycleSummary = {
  id: string;
  size: number;
  nodes: string[];
};

export type DashboardVisibleGraphResponse = {
  generatedAt: string;
  entryId?: string;
  nodes: DashboardNodeSummary[];
  edges: DashboardVisibleEdge[];
  zones: DashboardZoneSummary[];
  stats: {
    rawNodeCount: number;
    rawEdgeCount: number;
    visibleNodeCount: number;
    visibleEdgeCount: number;
    hiddenNodeCount: number;
    collapsedZoneCount: number;
    summarizedZoneCount: number;
    renderTimeMs: number;
    cacheHit: boolean;
  };
  matrix: DashboardMatrix;
  impact?: DashboardImpactSummary;
  cycles: DashboardCycleSummary[];
  policyTrace: DashboardPolicyTrace[];
};

export type DashboardNodeDetail = {
  node: DashboardNodeSummary;
  incoming: Array<{ source: string; edgeTypes: GraphEdgeType[]; symbols: string[] }>;
  outgoing: Array<{ target: string; edgeTypes: GraphEdgeType[]; symbols: string[] }>;
  representativeReferences: Array<{
    source: string;
    target: string;
    methodName?: string;
    classPath?: string;
    responseType?: string;
    location?: SourceLocation;
    snippet?: string;
  }>;
};

export type DashboardBootstrap = {
  projectName: string;
  root: string;
  analysisOut: string;
  configPath?: string;
  generatedAt: string;
  summary: SummaryReport;
  unresolved: UnresolvedReport;
  labels?: LabelsIndex;
  entries: DashboardEntry[];
  policies: DashboardPolicy[];
  zones: DashboardZoneSummary[];
  defaultEntryId?: string;
  defaultVisibleGraph: DashboardVisibleGraphResponse;
  diagnostics: DiagnosticRecord[];
};
