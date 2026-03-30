import { GraphEdge } from "./graph";
import { ClassLabel, JspLabel, MethodLabel } from "./labels";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type DiagnosticRecord = {
  stage: string;
  severity: DiagnosticSeverity;
  path: string;
  category: string;
  summary: string;
  message: string;
  detail?: string;
  hint?: string;
  relatedUri?: string;
  symbol?: string;
  generatedPath?: string;
  snippet?: string;
  rawCause?: string;
  exceptionClass?: string;
  rootCauseClass?: string;
  rootCauseMessage?: string;
  stackTrace?: string;
  workerDiagnostics?: string;
  causeChain?: string[];
  missingClasses?: string[];
  missingPaths?: string[];
  unresolvedTaglibUris?: string[];
  location?: DiagnosticLocation;
};

export type DiagnosticPathGroup = {
  path: string;
  diagnostics: DiagnosticRecord[];
};

export type DiagnosticCauseGroup = {
  key: string;
  stage: string;
  category: string;
  summary: string;
  count: number;
  paths: string[];
  rootCauseClass?: string;
  rootCauseMessage?: string;
  relatedUri?: string;
  missingClasses: string[];
  missingPaths: string[];
  unresolvedTaglibUris: string[];
};

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
  diagnostics: DiagnosticRecord[];
  byPath: DiagnosticPathGroup[];
  byCause: DiagnosticCauseGroup[];
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
