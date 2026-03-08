import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { LeflectConfig } from "@leflect-java/schema";

import { createJavaDependencyCacheInput, resolveJavaClasspathEntries } from "../java-classpath";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("java classpath helpers", () => {
  it("collects configured classpath and conventional output directories", async () => {
    const root = await tempDir("leflect-java-cp-");
    const configuredJar = path.join(root, "lib", "support.jar");
    const targetClasses = path.join(root, "target", "classes");
    const gradleClasses = path.join(root, "build", "classes", "java", "main");

    await mkdir(path.dirname(configuredJar), { recursive: true });
    await writeFile(configuredJar, "");
    await mkdir(targetClasses, { recursive: true });
    await mkdir(gradleClasses, { recursive: true });

    const config: LeflectConfig = {
      root,
      analysisOut: path.join(root, "analysis"),
      java: {
        classpath: [configuredJar]
      },
      jsp: {
        astMode: "jasper"
      }
    };

    const entries = await resolveJavaClasspathEntries(config);

    expect(entries).toContain(configuredJar);
    expect(entries).toContain(targetClasses);
    expect(entries).toContain(gradleClasses);
  });

  it("includes build markers in java dependency cache input", async () => {
    const root = await tempDir("leflect-java-cp-");
    await writeFile(path.join(root, "pom.xml"), "<project />");
    await writeFile(path.join(root, "build.gradle"), "plugins {}");

    const config: LeflectConfig = {
      root,
      analysisOut: path.join(root, "analysis"),
      java: {
        classpath: [path.join(root, "lib", "support.jar")],
        mavenCommand: "/custom/mvn"
      },
      jsp: {
        astMode: "jasper"
      }
    };

    const cacheInput = await createJavaDependencyCacheInput(config);

    expect(cacheInput).toMatchObject({
      mavenCommand: "/custom/mvn",
      classpath: [path.join(root, "lib", "support.jar")]
    });
    expect(cacheInput["markerFiles"]).toMatchObject({
      "pom.xml": expect.any(String),
      "build.gradle": expect.any(String),
      "build.gradle.kts": null
    });
  });
});
