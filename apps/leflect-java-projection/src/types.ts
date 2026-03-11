export type ProjectionNodeType = "java" | "jsp" | "unresolved";
export type ProjectionDirection = "outbound" | "inbound" | "both";

export type ProjectionBootstrap = {
  projectName: string;
  analysisOut: string;
  counts: {
    totalFiles: number;
    javaFiles: number;
    jspFiles: number;
    edges: number;
    classes: number;
    methods: number;
  };
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

export type ProjectionGraphNode = {
  id: string;
  path: string;
  nodeType: ProjectionNodeType;
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
