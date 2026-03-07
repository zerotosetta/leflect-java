export type LeflectConfig = {
  root: string;
  analysisOut: string;
  ignoreFile?: string;
  labelsOut?: string;
};

export type LeflectConfigInput = Partial<
  Omit<LeflectConfig, "root">
> & {
  root?: string;
};

export const defaultConfig: Omit<LeflectConfig, "root"> = {
  analysisOut: "analysis",
  labelsOut: "analysis/index/labels.json"
};
