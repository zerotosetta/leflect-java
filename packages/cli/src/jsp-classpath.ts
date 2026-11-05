import { LeflectConfig } from "@leflect-java/schema";

import {
  discoverSystemClasspathEntries,
  isSystemClasspathDiscoveryEnabled,
  resolveSystemClasspathSearchRoots
} from "./auto-classpath";
import { createDependencyCacheInput, resolveDependencyClasspathEntries } from "./classpath";
import { createApiPackCacheInput, resolveApiPackClasspath } from "./api-packs";

const OUTPUT_DIRECTORIES = [
  "target/classes",
  "src/main/webapp/WEB-INF/classes"
];

export async function resolveJspClasspathEntries(
  config: LeflectConfig,
  taglibUris: string[] = []
): Promise<string[]> {
  const projectEntries = await resolveDependencyClasspathEntries({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    mavenEnabled: config.jsp?.mavenClasspath,
    outputDirectories: OUTPUT_DIRECTORIES
  });
  const entries = await resolveApiPackClasspath(config, projectEntries, "jsp");

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
  return { ...await createDependencyCacheInput({
    root: config.root,
    configuredEntries: config.jsp?.classpath,
    mavenCommand: config.jsp?.mavenCommand,
    mavenEnabled: config.jsp?.mavenClasspath,
    markerFiles: ["pom.xml"],
    autoDiscovery: config.classpathDiscovery
  }), apiPacks: await createApiPackCacheInput(config) };
}
