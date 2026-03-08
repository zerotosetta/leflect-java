import os from "os";
import path from "path";
import { mkdtemp, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../config";
import { buildJavaInputManifest, buildJspInputManifest } from "../manifests";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("loadConfig", () => {
  it("uses defaults when config file is missing", async () => {
    const root = await tempDir("leflect-config-");
    const result = await loadConfig({ root });

    expect(result.loaded).toBe(false);
    expect(result.config.root).toBe(root);
    expect(result.config.analysisOut).toBe(path.join(root, "analysis"));
    expect(result.config.labelsOut).toBe(path.join(root, "analysis", "index", "labels.json"));
    expect(result.config.java).toBeDefined();
    expect(result.config.jsp?.astMode).toBe("jasper");
  });

  it("loads config file and resolves relative paths", async () => {
    const root = await tempDir("leflect-config-");
    const configPath = path.join(root, "leflect.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        analysisOut: "out",
        ignoreFile: ".leflectignore",
        labelsOut: "labels.json",
        java: {
          workerJar: "java-worker/target/leflectjava-java-worker.jar",
          javaHome: "./.java"
        },
        jsp: {
          astMode: "jasper",
          webappRoot: "src/main/webapp",
          generatedJavaOut: "analysis/generated-jsp-java",
          astOut: "analysis/jsp-ast",
          classpath: ["lib/taglibs.jar", "target/classes"],
          mavenCommand: "./tools/maven/bin/mvn"
        }
      })
    );

    const result = await loadConfig({ root });

    expect(result.loaded).toBe(true);
    expect(result.config.analysisOut).toBe(path.join(root, "out"));
    expect(result.config.ignoreFile).toBe(path.join(root, ".leflectignore"));
    expect(result.config.labelsOut).toBe(path.join(root, "labels.json"));
    expect(result.config.java?.workerJar).toBe(
      path.join(root, "java-worker", "target", "leflectjava-java-worker.jar")
    );
    expect(result.config.java?.javaHome).toBe(path.join(root, ".java"));
    expect(result.config.jsp?.astMode).toBe("jasper");
    expect(result.config.jsp?.webappRoot).toBe(path.join(root, "src", "main", "webapp"));
    expect(result.config.jsp?.generatedJavaOut).toBe(
      path.join(root, "analysis", "generated-jsp-java")
    );
    expect(result.config.jsp?.astOut).toBe(path.join(root, "analysis", "jsp-ast"));
    expect(result.config.jsp?.classpath).toEqual([
      path.join(root, "lib", "taglibs.jar"),
      path.join(root, "target", "classes")
    ]);
    expect(result.config.jsp?.mavenCommand).toBe(path.join(root, "tools", "maven", "bin", "mvn"));
  });

  it("preserves nested jsp defaults when config file overrides only one field", async () => {
    const root = await tempDir("leflect-config-");
    const configPath = path.join(root, "leflect.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        jsp: {
          webappRoot: "src/main/webapp"
        }
      })
    );

    const result = await loadConfig({ root });

    expect(result.config.jsp?.astMode).toBe("jasper");
    expect(result.config.jsp?.webappRoot).toBe(path.join(root, "src", "main", "webapp"));
  });

  it("applies overrides", async () => {
    const root = await tempDir("leflect-config-");

    const result = await loadConfig({
      root,
      overrides: {
        analysisOut: "custom"
      }
    });

    expect(result.config.analysisOut).toBe(path.join(root, "custom"));
    expect(result.config.labelsOut).toBe(path.join(root, "custom", "index", "labels.json"));
  });

  it("builds java and jsp worker manifests from config", async () => {
    const root = await tempDir("leflect-config-");
    const { config } = await loadConfig({
      root,
      overrides: {
        jsp: {
          astMode: "jasper"
        }
      }
    });

    const javaManifest = buildJavaInputManifest(config, ["src/A.java"]);
    const jspManifest = buildJspInputManifest(config, ["view/index.jsp"], [
      path.join(root, "lib", "taglibs.jar")
    ]);

    expect(javaManifest.outputDir).toBe(path.join(root, "analysis", "java-ast"));
    expect(jspManifest.webappRoot).toBe(root);
    expect(jspManifest.servletOutputDir).toBe(
      path.join(root, "analysis", "generated-jsp-java")
    );
    expect(jspManifest.astOutputDir).toBe(path.join(root, "analysis", "jsp-ast"));
    expect(jspManifest.classpathEntries).toEqual([path.join(root, "lib", "taglibs.jar")]);
  });
});
