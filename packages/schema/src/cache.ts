export type CachedFileEntry = {
  hash: string;
  type: "java" | "jsp" | "tld" | "other";
  size: number;
  mtimeMs: number;
  domain?: string;
};

export type FileHashesCache = {
  schemaVersion: string;
  generatedAt: string;
  root: string;
  configHash: string;
  files: Record<string, CachedFileEntry>;
  changed: string[];
  removed: string[];
};

export type StageName = "java-parse" | "jsp-parse" | "tld-parse";

export type StageCacheState<TEntry = never> = {
  schemaVersion: string;
  stage: StageName;
  generatedAt: string;
  cacheKey: string;
  files: Record<string, string>;
  entries?: Record<string, TEntry>;
};
