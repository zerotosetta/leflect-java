import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildJavaCommand, writeJavaManifest, writeJspManifest } from "../index";

describe("buildJavaCommand", () => {
  it("builds java -jar command", () => {
    const result = buildJavaCommand({
      jarPath: "/tmp/worker.jar",
      args: ["parse-java", "--manifest", "manifest.json"]
    });

    expect(result.command).toBe("java");
    expect(result.args).toEqual([
      "-jar",
      "/tmp/worker.jar",
      "parse-java",
      "--manifest",
      "manifest.json"
    ]);
  });

  it("prefers javaHome when javaPath is not provided", () => {
    const result = buildJavaCommand({
      javaHome: "/opt/jdk",
      jarPath: "/tmp/worker.jar",
      args: ["parse-jsp", "--manifest", "jsp-manifest.json"]
    });

    expect(result.command).toBe(path.join("/opt/jdk", "bin", "java"));
  });
});

describe("writeJspManifest", () => {
  it("writes jsp worker manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-jsp-manifest-"));
    const manifestPath = path.join(root, "analysis", "manifests", "jsp-parse.json");

    await writeJspManifest(manifestPath, {
      root,
      files: ["view/index.jsp"],
      webappRoot: root,
      servletOutputDir: path.join(root, "analysis", "generated-jsp-java"),
      astOutputDir: path.join(root, "analysis", "jsp-ast"),
      classpathEntries: [path.join(root, "lib", "tags.jar")],
      errorLog: path.join(root, "analysis", "logs", "jsp-parse-errors.jsonl")
    });

    const payload = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: string[];
      webappRoot: string;
      classpathEntries: string[];
    };

    expect(payload.files).toEqual(["view/index.jsp"]);
    expect(payload.webappRoot).toBe(root);
    expect(payload.classpathEntries).toEqual([path.join(root, "lib", "tags.jar")]);
  });
});

describe("writeJavaManifest", () => {
  it("writes java worker manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-java-manifest-"));
    const manifestPath = path.join(root, "analysis", "manifests", "java-parse.json");

    await writeJavaManifest(manifestPath, {
      root,
      files: ["src/main/java/demo/App.java"],
      outputDir: path.join(root, "analysis", "java-ast"),
      classpathEntries: [path.join(root, "lib", "support.jar")],
      errorLog: path.join(root, "analysis", "logs", "java-parse-errors.jsonl")
    });

    const payload = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: string[];
      outputDir: string;
      classpathEntries: string[];
    };

    expect(payload.files).toEqual(["src/main/java/demo/App.java"]);
    expect(payload.outputDir).toBe(path.join(root, "analysis", "java-ast"));
    expect(payload.classpathEntries).toEqual([path.join(root, "lib", "support.jar")]);
  });
});
