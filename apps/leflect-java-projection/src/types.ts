export type ProjectionNodeType = "java" | "jsp" | "unresolved" | "entry";
export type ProjectionDirection = "outbound";
export type ProjectionTreeMode = "classpath" | "directory";
export type ProjectionTheme = "dark" | "light" | "sky";
export type ProjectionGraphMode = "dependency" | "ast";
export type ProjectionAstLayout = "force" | "tree";
export type ProjectionDependencyEdgeKind = "call" | "import" | "type" | "tag";

export type ProjectionSourceLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

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
  entryType?: string;
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

export type ProjectionGraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
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

export type ProjectionAstGraphNodeCategory =
  | "root"
  | "declaration"
  | "member"
  | "statement"
  | "expression"
  | "tag"
  | "scriptlet"
  | "binding"
  | "external";

export type ProjectionAstGraphNode = {
  id: string;
  path: string;
  label: string;
  astType: string;
  category: ProjectionAstGraphNodeCategory;
  external: boolean;
  location?: ProjectionSourceLocation;
  detail?: string;
};

export type ProjectionAstGraphLink = {
  source: string;
  target: string;
  type: "child" | "call" | "reference" | "external";
  external: boolean;
  label?: string;
};

export type ProjectionAstGraphResponse = {
  focusPath: string;
  includeExternal: boolean;
  truncated: boolean;
  stats: {
    nodes: number;
    edges: number;
  };
  nodes: ProjectionAstGraphNode[];
  links: ProjectionAstGraphLink[];
};

export type ProjectionSourceLanguage = "java" | "jsp" | "plain";

export type ProjectionFileSource = {
  path: string;
  language: ProjectionSourceLanguage;
  content: string;
  truncated: boolean;
};

export type ProjectionSourceHighlight = {
  path: string;
  location?: ProjectionSourceLocation;
};

export type ProjectionFileDetail = {
  file: ProjectionFileEntry;
  metadata?: Record<string, unknown>;
  source?: ProjectionFileSource;
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

export type ProjectionFilesPageResponse = {
  files: ProjectionFileEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type ProjectionEntriesPageResponse = {
  entries: ProjectionEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type ProjectionTreeNode = {
  id: string;
  label: string;
  kind: "branch" | "file";
  fileCount: number;
  hasChildren: boolean;
  file?: ProjectionFileEntry;
};

export type ProjectionTreeResponse = {
  mode: ProjectionTreeMode;
  parentId?: string;
  totalFiles: number;
  nodes: ProjectionTreeNode[];
};

export type ProjectionTreeAncestorsResponse = {
  mode: ProjectionTreeMode;
  path: string;
  branchIds: string[];
};
