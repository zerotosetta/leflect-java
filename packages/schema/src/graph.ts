export type GraphEdgeType = "JAVA_CALL" | "JSP_SCRIPTLET_CALL" | "JSP_USES_TAG";

export type GraphConfidence = "high" | "medium" | "low" | "unresolved";

export type GraphEdge = {
  from: string;
  to: string;
  type: GraphEdgeType;
  confidence: GraphConfidence;
};
