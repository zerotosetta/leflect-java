export type ProjectionNodeType = "java" | "jsp" | "external" | "unresolved" | "entry";
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
    jspFragments?: number;
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
  sourceKind?: "jsp" | "jspf" | "tag" | "tagx";
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
  external?: {
    symbol: string;
    provider: { name: string; version?: string; path?: string };
    source: { status: string; archive?: string; entry?: string; version?: string };
  };
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
  http?: {
    servletName: string;
    className: string;
    urlPattern: string;
    sourcePath: string;
    lineRange: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    handlerMethodIds: string[];
    diagnostic?: string;
  };
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
  | "comment"
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
  metadata?: Record<string, unknown> & {
    referenceDiagnostics?: Array<{ snippet: string; message: string; location?: ProjectionSourceLocation }>;
    functionCalls?: Array<{
      prefix: string;
      name: string;
      uri?: string;
      className?: string;
      methodId?: string;
      targetFile?: string;
      validation: "source" | "classpath" | "unresolved" | "excluded";
      excludedReason?: string;
      unresolvedReason?: string;
      location: ProjectionSourceLocation;
    }>;
    taskCodes?: Array<{
      code?: string;
      state: string;
      uri: string;
      handlerClass: string;
      lineRange: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    }>;
    includeReferences?: Array<{
      page: string;
      kind: "static" | "dynamic";
      location: ProjectionSourceLocation;
      targetPath?: string;
      candidatePaths?: string[];
      parameters: Array<{ name: string; value: string }>;
      evidence?: Array<{ description: string; path?: string; role?: string; variable?: string; objectType?: string }>;
      unresolvedReason?: string;
    }>;
    beanActions?: Array<{
      id?: string;
      className?: string;
      actionDescription: string;
      api?: { javaVersion: string; description: string; source: string };
      apiDescriptionStatus: "available" | "source-unavailable" | "type-unavailable";
    }>;
    comments?: Array<{ text: string; lineRange: { startLine: number } }>;
    tags?: Array<{
      prefix: string;
      name: string;
      handlerClass?: string;
      tagFile?: string;
      location?: ProjectionSourceLocation;
      unresolvedReason?: string;
    }>;
    calls?: Array<{
      callerKind?: "static-initializer";
      fromClassId?: string;
      toMethodId?: string;
      to?: string;
      location?: ProjectionSourceLocation;
    }>;
  };
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
