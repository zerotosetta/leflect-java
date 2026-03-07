import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildJavaCommand, writeJspManifest } from "../index";

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
      errorLog: path.join(root, "analysis", "logs", "jsp-parse-errors.jsonl")
    });

    const payload = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: string[];
      webappRoot: string;
    };

    expect(payload.files).toEqual(["view/index.jsp"]);
    expect(payload.webappRoot).toBe(root);
  });
});
