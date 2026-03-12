import os from "os";
import path from "path";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { loadConfig, resolveDefaultConfigPath } from "../config";
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
    expect(result.config.classpathDiscovery).toEqual({ enabled: false });
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
        classpathDiscovery: {
          enabled: true,
          maxRetries: 2,
          searchRoots: ["./.m2/repository", "/opt/jars"]
        },
        entryFiles: {
          java: ["Controller\\.java$"],
          jsp: ["WEB-INF/jsp/.+\\.jsp$"]
        },
        java: {
          workerJar: "java-worker/target/leflectjava-java-worker.jar",
          jreHome: "./.jre",
          javaHome: "./.java",
          classpath: ["lib/support.jar", "target/classes"],
          mavenCommand: "./tools/maven/bin/mvn"
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
    expect(result.config.classpathDiscovery).toEqual({
      enabled: true,
      maxRetries: 2,
      searchRoots: [path.join(root, ".m2", "repository"), "/opt/jars"]
    });
    expect(result.config.entryFiles).toEqual({
      java: ["Controller\\.java$"],
      jsp: ["WEB-INF/jsp/.+\\.jsp$"]
    });
    expect(result.config.java?.workerJar).toBe(
      path.join(root, "java-worker", "target", "leflectjava-java-worker.jar")
    );
    expect(result.config.java?.jreHome).toBe(path.join(root, ".jre"));
    expect(result.config.java?.javaHome).toBe(path.join(root, ".java"));
    expect(result.config.java?.classpath).toEqual([
      path.join(root, "lib", "support.jar"),
      path.join(root, "target", "classes")
    ]);
    expect(result.config.java?.mavenCommand).toBe(path.join(root, "tools", "maven", "bin", "mvn"));
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

  it("discovers and loads a TypeScript config with local plugins", async () => {
    const workspaceRoot = path.resolve(__dirname, "../../../../");
    const root = await mkdtemp(path.join(workspaceRoot, ".tmp-leflect-config-"));

    try {
      await mkdir(path.join(root, "leflect", "plugins"), { recursive: true });
      await writeFile(
        path.join(root, "leflect", "plugins", "dynamic-query-plugin.ts"),
        [
          "export function dynamicQueryPlugin() {",
          "  return {",
          "    name: 'dynamic-query',",
          "    enforce: 'pre',",
          "    hooks: [{",
          "      id: 'invoke-query',",
          "      target: 'java',",
          "      when() { return true; },",
          "      resolve() { return { matched: false }; }",
          "    }]",
          "  };",
          "}",
          ""
        ].join("\n")
      );
      await writeFile(
        path.join(root, "leflect.config.ts"),
        [
          "import { defineConfig } from '@leflect-java/core';",
          "import { dynamicQueryPlugin } from './leflect/plugins/dynamic-query-plugin';",
          "",
          "export default defineConfig({",
          "  analysisOut: './custom-analysis',",
          "  entries: [",
          "    {",
          "      id: 'account.list',",
          "      type: 'virtual_page',",
          "      jsp: ['./src/main/webapp/WEB-INF/jsp/account/list.jsp'],",
          "      java: ['src/main/java/com/example/account/AccountController.java'],",
          "      query: ['account.selectBalance'],",
          "      interfaceSpecs: ['IF_ACCOUNT_BALANCE'],",
          "      variants: [",
          "        {",
          "          id: 'account.list.mobile',",
          "          jsp: ['src/main/webapp/WEB-INF/jsp/mobile/account/list.jsp']",
          "        }",
          "      ]",
          "    }",
          "  ],",
          "  plugins: [dynamicQueryPlugin()]",
          "});",
          ""
        ].join("\n")
      );

      const resolvedPath = await resolveDefaultConfigPath(root);
      const result = await loadConfig({ root });

      expect(resolvedPath).toBe(path.join(root, "leflect.config.ts"));
      expect(result.loaded).toBe(true);
      expect(result.configPath).toBe(path.join(root, "leflect.config.ts"));
      expect(result.config.analysisOut).toBe(path.join(root, "custom-analysis"));
      expect(result.config.entries).toEqual([
        {
          id: "account.list",
          type: "virtual_page",
          jsp: ["src/main/webapp/WEB-INF/jsp/account/list.jsp"],
          java: ["src/main/java/com/example/account/AccountController.java"],
          query: ["account.selectBalance"],
          interfaceSpecs: ["IF_ACCOUNT_BALANCE"],
          variants: [
            {
              id: "account.list.mobile",
              jsp: ["src/main/webapp/WEB-INF/jsp/mobile/account/list.jsp"]
            }
          ]
        }
      ]);
      expect(result.config.plugins).toHaveLength(1);
      expect(result.config.plugins?.[0]?.name).toBe("dynamic-query");
      expect(result.config.plugins?.[0]?.enforce).toBe("pre");
      expect(result.config.plugins?.[0]?.hooks?.[0]?.id).toBe("invoke-query");
      expect(typeof result.config.plugins?.[0]?.hooks?.[0]?.when).toBe("function");
      expect(typeof result.config.plugins?.[0]?.hooks?.[0]?.resolve).toBe("function");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it("resolves jreHome from overrides", async () => {
    const root = await tempDir("leflect-config-");

    const result = await loadConfig({
      root,
      overrides: {
        java: {
          jreHome: "./runtime/jre"
        }
      }
    });

    expect(result.config.java?.jreHome).toBe(path.join(root, "runtime", "jre"));
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

    const javaManifest = buildJavaInputManifest(config, ["src/A.java"], [
      path.join(root, "lib", "support.jar")
    ]);
    const jspManifest = buildJspInputManifest(config, ["view/index.jsp"], [
      path.join(root, "lib", "taglibs.jar")
    ]);

    expect(javaManifest.outputDir).toBe(path.join(root, "analysis", "java-ast"));
    expect(javaManifest.classpathEntries).toEqual([path.join(root, "lib", "support.jar")]);
    expect(jspManifest.webappRoot).toBe(root);
    expect(jspManifest.servletOutputDir).toBe(
      path.join(root, "analysis", "generated-jsp-java")
    );
    expect(jspManifest.astOutputDir).toBe(path.join(root, "analysis", "jsp-ast"));
    expect(jspManifest.classpathEntries).toEqual([path.join(root, "lib", "taglibs.jar")]);
  });
});
