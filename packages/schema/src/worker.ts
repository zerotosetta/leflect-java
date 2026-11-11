export type JavaInputManifest = {
  root: string;
  files: string[];
  outputDir: string;
  classpathEntries: string[];
  isolatedClasspath?: boolean;
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
