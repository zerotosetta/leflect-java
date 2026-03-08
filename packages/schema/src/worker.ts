export type JavaInputManifest = {
  root: string;
  files: string[];
  outputDir: string;
  errorLog: string;
};

export type JspInputManifest = {
  root: string;
  files: string[];
  webappRoot: string;
  servletOutputDir: string;
  astOutputDir: string;
  classpathEntries: string[];
  errorLog: string;
};
