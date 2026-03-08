import path from "path";

import { JavaInputManifest, JspInputManifest, LeflectConfig } from "@lefectjava/schema";

export function buildJavaInputManifest(
  config: LeflectConfig,
  files: string[],
  classpathEntries: string[] = []
): JavaInputManifest {
  return {
    root: config.root,
    files,
    outputDir: path.join(config.analysisOut, "java-ast"),
    classpathEntries,
    errorLog: path.join(config.analysisOut, "logs", "java-parse-errors.jsonl")
  };
}

export function buildJspInputManifest(
  config: LeflectConfig,
  files: string[],
  classpathEntries: string[] = []
): JspInputManifest {
  return {
    root: config.root,
    files,
    webappRoot: config.jsp?.webappRoot ?? config.root,
    servletOutputDir:
      config.jsp?.generatedJavaOut ?? path.join(config.analysisOut, "generated-jsp-java"),
    astOutputDir: config.jsp?.astOut ?? path.join(config.analysisOut, "jsp-ast"),
    classpathEntries,
    errorLog: path.join(config.analysisOut, "logs", "jsp-parse-errors.jsonl")
  };
}
