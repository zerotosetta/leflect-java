import { GraphEdge } from "./graph";
import { ClassLabel, JspLabel, MethodLabel } from "./labels";

export type SummaryReport = {
  schemaVersion: string;
  generatedAt: string;
  counts: {
    classes: number;
    methods: number;
    jsps: number;
    taglibs: number;
    javaCallEdges: number;
    jspJavaEdges: number;
    unresolvedEdges: number;
  };
  labels: {
    classes: Record<ClassLabel, number>;
    methods: Record<MethodLabel, number>;
    jsps: Record<JspLabel, number>;
  };
  jspImpacts: Array<{
    jspPath: string;
    labels: JspLabel[];
    javaTargets: string[];
    tagHandlers: string[];
    unresolvedTargets: string[];
  }>;
};

export type UnresolvedReport = {
  schemaVersion: string;
  generatedAt: string;
  edges: GraphEdge[];
};

export type JspImpactQueryResult = {
  file: string;
  labels: JspLabel[];
  javaTargets: string[];
  tagHandlers: string[];
  unresolvedTargets: string[];
  edges: GraphEdge[];
};

export type JavaUsagesQueryResult = {
  classId: string;
  className?: string;
  labels: ClassLabel[];
  javaCallers: string[];
  jspCallers: string[];
  tagUsageJsp: string[];
};

export type TagUsagesQueryResult = {
  classId: string;
  className?: string;
  labels: ClassLabel[];
  jspFiles: string[];
};
