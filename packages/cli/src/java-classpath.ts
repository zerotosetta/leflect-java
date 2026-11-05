import { LeflectConfig } from "@leflect-java/schema";

import {
  collectJavaImportQueries,
  discoverSystemClasspathEntries,
  isSystemClasspathDiscoveryEnabled,
  resolveSystemClasspathSearchRoots
} from "./auto-classpath";
import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";
import { createApiPackCacheInput, resolveApiPackClasspath } from "./api-packs";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "build/classes/java/main"
];

export async function resolveJavaClasspathEntries(
  config: LeflectConfig,
  files: string[] = []
): Promise<string[]> {
  const projectEntries = await resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    mavenEnabled: config.java?.mavenClasspath,
    outputDirectories: OUTPUT_DIRECTORIES
  });
  const entries = await resolveApiPackClasspath(config, projectEntries, "java");

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
  return { ...await createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.java?.classpath,
    mavenCommand: config.java?.mavenCommand,
    mavenEnabled: config.java?.mavenClasspath,
    markerFiles: [
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts"
    ],
    autoDiscovery: config.classpathDiscovery
  }), apiPacks: await createApiPackCacheInput(config) };
}
