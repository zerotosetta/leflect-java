import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { LeflectConfig } from "@leflect-java/schema";

import { resolveMavenCommand, splitClasspath } from "../classpath";
import {
  createJspDependencyCacheInput,
  resolveJspClasspathEntries
} from "../jsp-classpath";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("jsp classpath helpers", () => {
  it("splits a classpath string using the platform delimiter", () => {
    expect(splitClasspath(["a", "b", "c"].join(path.delimiter))).toEqual(["a", "b", "c"]);
  });

  it("prefers an explicit maven command and discovers wrapper scripts", async () => {
    const root = await tempDir("leflect-jsp-cp-");
    const wrapper = path.join(root, "mvnw");
    await writeFile(wrapper, "#!/usr/bin/env bash\n");

    expect(await resolveMavenCommand(root, "/custom/mvn")).toBe("/custom/mvn");
    expect(await resolveMavenCommand(root)).toBe(wrapper);
  });

  it("collects configured classpath and output directories", async () => {
    const root = await tempDir("leflect-jsp-cp-");
    const configuredJar = path.join(root, "lib", "tags.jar");
    const targetClasses = path.join(root, "target", "classes");
    const webInfClasses = path.join(root, "src", "main", "webapp", "WEB-INF", "classes");

    await mkdir(path.dirname(configuredJar), { recursive: true });
    await writeFile(configuredJar, "");
    await mkdir(targetClasses, { recursive: true });
    await mkdir(webInfClasses, { recursive: true });

    const config: LeflectConfig = {
      root,
      analysisOut: path.join(root, "analysis"),
      java: {},
      jsp: {
        astMode: "jasper",
        classpath: [configuredJar]
      }
    };

    const entries = await resolveJspClasspathEntries(config);

    expect(entries).toContain(configuredJar);
    expect(entries).toContain(targetClasses);
    expect(entries).toContain(webInfClasses);
  });

  it("includes pom hash in jsp dependency cache input", async () => {
    const root = await tempDir("leflect-jsp-cp-");
    await writeFile(path.join(root, "pom.xml"), "<project />");

    const config: LeflectConfig = {
      root,
      analysisOut: path.join(root, "analysis"),
      java: {},
      jsp: {
        astMode: "jasper",
        classpath: [path.join(root, "lib", "tags.jar")],
        mavenCommand: "/custom/mvn"
      }
    };

    const cacheInput = await createJspDependencyCacheInput(config);

    expect(cacheInput).toMatchObject({
      mavenCommand: "/custom/mvn",
      classpath: [path.join(root, "lib", "tags.jar")]
    });
    expect(cacheInput["markerFiles"]).toMatchObject({
      "pom.xml": expect.any(String)
    });
  });
});
