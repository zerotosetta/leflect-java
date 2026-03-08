import { LeflectConfig } from "@lefectjava/schema";

import {
  collectJavaImportQueries,
  discoverSystemClasspathEntries,
  isSystemClasspathDiscoveryEnabled,
  resolveSystemClasspathSearchRoots
} from "./auto-classpath";
import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "build/classes/java/main"
];

export async function resolveJavaClasspathEntries(
  config: LeflectConfig,
  files: string[] = []
): Promise<string[]> {
  const entries = await resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    outputDirectories: OUTPUT_DIRECTORIES
  });

  if (!isSystemClasspathDiscoveryEnabled(config) || files.length === 0) {
    return entries;
  }

  const importQueries = await collectJavaImportQueries(config.root, files);
  const discovered = await discoverSystemClasspathEntries({
    existingEntries: entries,
    searchRoots: resolveSystemClasspathSearchRoots(config),
    classQueries: importQueries
  });

  return [...new Set([...entries, ...discovered])];
}

export async function createJavaDependencyCacheInput(
  config: LeflectConfig
): Promise<Record<string, unknown>> {
  return createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    markerFiles: [
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts"
    ],
    autoDiscovery: config.classpathDiscovery
  });
}
