import os from "os";
import path from "path";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../index";
import {
  createConfigFromAnswers,
  discoverInitDefaults,
  InitAnswers,
  renderConfigFile
} from "../init";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("init command", () => {
  afterEach(() => {
    delete process.env.LEFLECT_JAVA_WORKER_JAR;
    vi.restoreAllMocks();
  });

  it("discovers worker and webapp defaults", async () => {
    const root = await tempDir("leflect-init-");
    const workerJar = path.join(root, "runtime", "worker.jar");
    await mkdir(path.dirname(workerJar), { recursive: true });
    await mkdir(path.join(root, "src", "main", "webapp"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "analysis/\n");
    await writeFile(path.join(root, "pom.xml"), "<project />\n");
    await writeFile(workerJar, "jar");
    process.env.LEFLECT_JAVA_WORKER_JAR = workerJar;

    const defaults = await discoverInitDefaults(root);

    expect(defaults.workerJarAvailable).toBe(true);
    expect(defaults.autoSystemClasspathEnabled).toBe(false);
    expect(defaults.jspAstMode).toBe("jasper");
    expect(defaults.webappRoot).toBe("src/main/webapp");
    expect(defaults.ignoreFile).toBe(".gitignore");
    expect(defaults.javaMavenCommand).toBe("mvn");
  });

  it("creates a config with relative paths and entry regexes", () => {
    const answers: InitAnswers = {
      analysisOut: "./analysis",
      ignoreFile: ".gitignore",
      labelsOut: "./analysis/index/labels.json",
      autoSystemClasspath: true,
      systemClasspathRoots: ["/repo/.m2/repository"],
      systemClasspathMaxRetries: 4,
      useWorker: true,
      workerJar: "/repo/tools/worker.jar",
      jreHome: "/repo/runtime/jre",
      javaHome: undefined,
      javaClasspath: ["/repo/lib/a.jar", "/repo/lib/b.jar"],
      javaMavenCommand: "./mvnw",
      jspAstMode: "jasper",
      webappRoot: "src/main/webapp",
      jspClasspath: ["/repo/lib/taglibs.jar"],
      jspMavenCommand: "mvn",
      entryJava: ["Controller\\.java$"],
      entryJsp: ["WEB-INF/jsp/.+\\.jsp$"]
    };

    const config = createConfigFromAnswers("/repo", answers);

    expect(config).toEqual({
      analysisOut: "./analysis",
      ignoreFile: "./.gitignore",
      labelsOut: "./analysis/index/labels.json",
      classpathDiscovery: {
        enabled: true,
        searchRoots: ["./.m2/repository"],
        maxRetries: 4
      },
      entryFiles: {
        java: ["Controller\\.java$"],
        jsp: ["WEB-INF/jsp/.+\\.jsp$"]
      },
      java: {
        workerJar: "./tools/worker.jar",
        jreHome: "./runtime/jre",
        classpath: ["./lib/a.jar", "./lib/b.jar"],
        mavenCommand: "./mvnw"
      },
      jsp: {
        astMode: "jasper",
        generatedJavaOut: "./analysis/generated-jsp-java",
        astOut: "./analysis/jsp-ast",
        webappRoot: "./src/main/webapp",
        classpath: ["./lib/taglibs.jar"],
        mavenCommand: "mvn"
      }
    });
  });

  it("writes a default config in non-interactive mode", async () => {
    const root = await tempDir("leflect-init-");
    const workerJar = path.join(root, "runtime", "worker.jar");
    const configPath = path.join(root, "leflect.config.json");
    await mkdir(path.join(root, "src", "main", "webapp"), { recursive: true });
    await mkdir(path.dirname(workerJar), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "analysis/\n");
    await writeFile(workerJar, "jar");
    process.env.LEFLECT_JAVA_WORKER_JAR = workerJar;

    await run(["init", "--root", root, "--yes"]);

    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(config["analysisOut"]).toBe("./analysis");
    expect(config["ignoreFile"]).toBe("./.gitignore");
    expect(config["labelsOut"]).toBe("./analysis/index/labels.json");
    expect(config["jsp"]).toMatchObject({
      astMode: "jasper",
      webappRoot: "./src/main/webapp"
    });
    expect(config["java"]).toEqual({});
    expect((config["java"] as Record<string, unknown>)["workerJar"]).toBeUndefined();
  });

  it("renders a TypeScript config file", () => {
    const config = renderConfigFile(
      {
        analysisOut: "./analysis",
        entries: [
          {
            id: "account.list",
            type: "virtual_page",
            jsp: ["src/main/webapp/WEB-INF/jsp/account/list.jsp"]
          }
        ]
      },
      "ts"
    );

    expect(config).toContain("import { defineConfig } from \"@leflect-java/core\";");
    expect(config).toContain("export default defineConfig(");
    expect(config).toContain("\"account.list\"");
  });

  it("writes a TypeScript config when requested", async () => {
    const root = await tempDir("leflect-init-");
    const configPath = path.join(root, "leflect.config.ts");

    await run(["init", "--root", root, "--config-format", "ts", "--yes"]);

    const config = await readFile(configPath, "utf8");
    expect(config).toContain("defineConfig");
    expect(config).toContain("analysisOut");
  });
});
