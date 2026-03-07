export type JspAstMode = "lightweight" | "jasper";

export type LeflectConfig = {
  root: string;
  analysisOut: string;
  ignoreFile?: string;
  labelsOut?: string;
  java?: {
    workerJar?: string;
    javaHome?: string;
  };
  jsp?: {
    astMode?: JspAstMode;
    webappRoot?: string;
    generatedJavaOut?: string;
    astOut?: string;
  };
};

export type LeflectConfigInput = Partial<
  Omit<LeflectConfig, "root">
> & {
  root?: string;
};

export const defaultConfig: Omit<LeflectConfig, "root"> = {
  analysisOut: "analysis",
  java: {},
  jsp: {
    astMode: "lightweight"
  }
};
