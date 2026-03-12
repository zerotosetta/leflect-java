export type ProjectionNodeType = "java" | "jsp" | "unresolved";
export type ProjectionDirection = "outbound";

export type ProjectionBootstrap = {
  projectName: string;
  analysisOut: string;
  counts: {
    totalFiles: number;
    javaFiles: number;
    jspFiles: number;
    entries: number;
    edges: number;
    classes: number;
    methods: number;
  };
  defaultEntryId?: string;
  defaultFile?: string;
  tabs: Array<{ id: string; label: string }>;
};

export type ProjectionFileEntry = {
  path: string;
  nodeType: ProjectionNodeType;
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
  referenceCount: number;
  dependantCount: number;
};

export type ProjectionEntry = {
  id: string;
  label: string;
  source: "declared" | "matched";
  focusPath?: string;
  focusNodeType?: Exclude<ProjectionNodeType, "unresolved">;
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

export type ProjectionGraphNode = {
  id: string;
  path: string;
  nodeType: ProjectionNodeType;
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

export type ProjectionFileDetail = {
  file: ProjectionFileEntry;
  metadata?: Record<string, unknown>;
  references: Array<{
    path: string;
    nodeType: ProjectionNodeType;
    edgeTypes: string[];
    symbols: string[];
  }>;
  referencedBy: Array<{
    path: string;
    nodeType: ProjectionNodeType;
    edgeTypes: string[];
    symbols: string[];
  }>;
};
