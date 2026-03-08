export type JspAstMode = "lightweight" | "jasper";

export type LeflectConfig = {
  root: string;
  analysisOut: string;
  ignoreFile?: string;
  labelsOut?: string;
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
    classpath?: string[];
    mavenCommand?: string;
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
