export type GraphEdgeType = "JAVA_CALL" | "JSP_SCRIPTLET_CALL" | "JSP_USES_TAG";

export type GraphConfidence = "high" | "medium" | "low" | "unresolved";

export type GraphNodeType = "java" | "jsp" | "unresolved";

export type GraphEdge = {
  from: string;
  to: string;
  type: GraphEdgeType;
  confidence: GraphConfidence;
  fromFile?: string;
  toFile?: string;
  fromSymbol?: string;
  toSymbol?: string;
};

export type FileDependencyReference = {
  path: string;
  nodeType: GraphNodeType;
  edgeTypes: GraphEdgeType[];
  symbols: string[];
};

export type FileDependencyRecord = {
  path: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  referenceCount: number;
  dependantCount: number;
  references: FileDependencyReference[];
  referencedBy: FileDependencyReference[];
};

export type FileDependencyIndex = {
  schemaVersion: string;
  generatedAt: string;
  files: FileDependencyRecord[];
};

export type EntryFilePatternMatch = {
  path: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  matchedBy: string[];
};

export type EntryDependencyRecord = {
  entry: string;
  nodeType: Exclude<GraphNodeType, "unresolved">;
  matchedBy: string[];
  nodeCount: number;
  edgeCount: number;
  reachableFiles: string[];
  edges: GraphEdge[];
};

export type EntryDependencyIndex = {
  schemaVersion: string;
  generatedAt: string;
  patterns: {
    java: string[];
    jsp: string[];
  };
  matchedEntries: EntryFilePatternMatch[];
  unmatchedPatterns: Array<{
    nodeType: Exclude<GraphNodeType, "unresolved">;
    pattern: string;
  }>;
  entries: EntryDependencyRecord[];
};
