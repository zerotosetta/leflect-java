import { LeflectConfig } from "@lefectjava/schema";

import {
  discoverSystemClasspathEntries,
  isSystemClasspathDiscoveryEnabled,
  resolveSystemClasspathSearchRoots
} from "./auto-classpath";
import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "src/main/webapp/WEB-INF/classes"
];

export async function resolveJspClasspathEntries(
  config: LeflectConfig,
  taglibUris: string[] = []
): Promise<string[]> {
  const entries = await resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    outputDirectories: OUTPUT_DIRECTORIES
  });

  if (!isSystemClasspathDiscoveryEnabled(config) || taglibUris.length === 0) {
    return entries;
  }

  const discovered = await discoverSystemClasspathEntries({
    existingEntries: entries,
    searchRoots: resolveSystemClasspathSearchRoots(config),
    taglibUriQueries: taglibUris
  });

  return [...new Set([...entries, ...discovered])];
}

export async function createJspDependencyCacheInput(
  config: LeflectConfig
): Promise<Record<string, unknown>> {
  return createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    markerFiles: ["pom.xml"],
    autoDiscovery: config.classpathDiscovery
  });
}
