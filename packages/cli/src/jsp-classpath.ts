import { LeflectConfig } from "@lefectjava/schema";

import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "src/main/webapp/WEB-INF/classes"
];

export async function resolveJspClasspathEntries(config: LeflectConfig): Promise<string[]> {
  return resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    outputDirectories: OUTPUT_DIRECTORIES
  });
}

export async function createJspDependencyCacheInput(
  config: LeflectConfig
): Promise<Record<string, unknown>> {
  return createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    markerFiles: ["pom.xml"]
  });
}
