export type SourceTarget =
  | { targetId: string; kind: "jsp"; path: string }
  | { targetId: string; kind: "java"; className: string }
  | { targetId: string; kind: "source"; sourceId: string };

export type ResolveReferencesRequest = {
  targets: SourceTarget[];
  baseSnapshotId?: string;
  scope?: { followReferences?: boolean; maxDepth?: number };
};

export type SourceKind = "jsp" | "java";
export type SourceStatus = "resolved" | "ambiguous" | "missing" | "binary_only" | "unsupported" | "dynamic" | "blocked" | "limit";
export type SourceDiagnostic = {
  code: string;
  message: string;
  rootId?: string;
  path?: string;
  needed?: string;
};

export type SourceCandidate = {
  rootId: string;
  path: string;
  className?: string;
  logicalPath?: string;
  sourceId?: string;
  sourceHash?: string;
};

export type SourceDescriptor = {
  sourceId: string;
  sourceHash: string;
  path: string;
  rootId: string;
  encoding: string;
  kind: SourceKind;
  byteLength: number;
};

export type EvidenceLocation = Pick<SourceDescriptor, "sourceId" | "sourceHash" | "path" | "rootId"> & {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

export type ResolutionDiagnostic = SourceDiagnostic & { targetId?: string; location?: EvidenceLocation };

export type TargetResult = {
  targetId: string;
  kind: SourceTarget["kind"];
  status: SourceStatus;
  candidates: SourceCandidate[];
  path?: string;
  className?: string;
  sourceId?: string;
  sourceHash?: string;
};

export type IncludeContext = {
  entryPath: string;
  entrySourceId: string;
  includeChain: EvidenceLocation[];
};

export type ReferenceResult = {
  status: SourceStatus;
  candidates: SourceCandidate[];
  targetId: string;
  kind: "java-type" | "jsp-include";
  expression: string;
  location: EvidenceLocation;
  importLocation?: EvidenceLocation;
  context?: IncludeContext;
  includeKind?: "translation" | "request";
  binding?: "verified" | "candidate" | "unresolved";
};

export type ResolveReferencesResult = {
  schemaVersion: 1;
  status: "complete" | "partial";
  diagnostics: ResolutionDiagnostic[];
  nextCursor: null;
  snapshotId: string;
  targets: TargetResult[];
  references: ReferenceResult[];
  sources: SourceDescriptor[];
  unprocessedTargetIds: string[];
};

export type SourceResolutionApi = {
  resolveReferences(request: ResolveReferencesRequest): Promise<ResolveReferencesResult>;
};
