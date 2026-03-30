import type { LeflectPlugin } from "./plugin";
import type { JspTaglibResolver } from "./jsp";

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
};

export type LeflectConfig = {
  root: string;
  analysisOut: string;
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
    jreHome?: string;
    javaHome?: string;
    classpath?: string[];
    mavenCommand?: string;
  };
  jsp?: {
    astMode?: JspAstMode;
    webappRoot?: string;
    generatedJavaOut?: string;
    astOut?: string;
    semanticAstOut?: string;
    classpath?: string[];
    mavenCommand?: string;
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
