import type { LeflectPlugin } from "./plugin";
import type { JspTaglibResolver } from "./jsp";
import type { ServletEntryMetadata } from "./servlet";

export type JspAstMode = "lightweight" | "jasper";

export type LeflectEntryType = "virtual_page" | "entry";

export type LeflectEntryVariant = {
  id: string;
  label?: string;
  description?: string;
  jsp?: string[];
  java?: string[];
  query?: string[];
  interfaceSpecs?: string[];
  tags?: string[];
};

export type LeflectEntryDefinition = {
  id: string;
  type: LeflectEntryType;
  label?: string;
  description?: string;
  jsp?: string[];
  java?: string[];
  query?: string[];
  interfaceSpecs?: string[];
  tags?: string[];
  variants?: LeflectEntryVariant[];
  http?: ServletEntryMetadata;
};

export type SourceResolutionLimits = {
  maxDepth: number;
  maxFiles: number;
  maxProbes: number;
  maxFileBytes: number;
  maxTotalSourceBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
};

export type SourceResolutionLoggingConfig = {
  path: string;
  includePayloads?: boolean;
};

export type SourceResolutionConfig = {
  webRoot?: string;
  javaRoots?: string[];
  javaMap?: Record<string, string>;
  sourceMap?: Record<string, string>;
  encoding?: string;
  encodingOverrides?: Record<string, string>;
  limits?: Partial<SourceResolutionLimits>;
  logging?: SourceResolutionLoggingConfig;
};

export type LeflectConfig = {
  root: string;
  analysisOut: string;
  sourceResolution?: SourceResolutionConfig;
  ignoreFile?: string;
  labelsOut?: string;
  entries?: LeflectEntryDefinition[];
  plugins?: LeflectPlugin[];
  classpathDiscovery?: {
    enabled?: boolean;
    maxRetries?: number;
    searchRoots?: string[];
  };
  entryFiles?: {
    java?: string[];
    jsp?: string[];
  };
  java?: {
    workerJar?: string;
    targetVersion?: string;
    sourceArchive?: string;
    librarySources?: Array<{ archive: string; provider: string; version?: string }>;
    jreHome?: string;
    javaHome?: string;
    classpath?: string[];
    mavenCommand?: string;
    /** Include Maven compile/provided/runtime dependencies (default true). */
    mavenClasspath?: boolean;
    apiPacks?: {
      mode?: "off" | "fallback";
      /** Optional directory containing a verified API pack manifest.json. */
      directory?: string;
    };
  };
  jsp?: {
    astMode?: JspAstMode;
    webappRoot?: string;
    includeTargets?: Record<string, string>;
    generatedJavaOut?: string;
    astOut?: string;
    semanticAstOut?: string;
    classpath?: string[];
    mavenCommand?: string;
    mavenClasspath?: boolean;
    tld?: {
      autoLoad?: boolean;
      paths?: string[];
      uriMap?: Record<string, string>;
    };
    taglibResolvers?: Record<string, JspTaglibResolver>;
  };
};

export type LeflectConfigInput = Partial<
  Omit<LeflectConfig, "root">
> & {
  root?: string;
};

export const defaultConfig: Omit<LeflectConfig, "root"> = {
  analysisOut: "analysis",
  classpathDiscovery: {
    enabled: false
  },
  java: {},
  jsp: {
    astMode: "jasper"
  }
};
