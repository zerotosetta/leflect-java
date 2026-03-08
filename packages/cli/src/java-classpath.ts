import { LeflectConfig } from "@lefectjava/schema";

import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "build/classes/java/main"
];

export async function resolveJavaClasspathEntries(config: LeflectConfig): Promise<string[]> {
  return resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    outputDirectories: OUTPUT_DIRECTORIES
  });
}

export async function createJavaDependencyCacheInput(
  config: LeflectConfig
): Promise<Record<string, unknown>> {
  return createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    markerFiles: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]
  });
}
