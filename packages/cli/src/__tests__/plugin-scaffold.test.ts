import os from "os";
import path from "path";
import { mkdtemp, readFile, rm } from "fs/promises";

import { describe, expect, it } from "vitest";

import { run } from "../index";
import { renderPluginScaffold } from "../plugin-scaffold";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("plugin scaffold command", () => {
  it("renders a stable TypeScript plugin template", () => {
    const output = renderPluginScaffold({
      pluginName: "dynamic-query-plugin",
      factoryName: "dynamicQueryPlugin",
      target: "java"
    });

    expect(output).toContain("export function dynamicQueryPlugin(): LeflectPlugin");
    expect(output).toContain("name: \"dynamic-query-plugin\"");
    expect(output).toContain("target: \"java\"");
    expect(output).toContain("dynamic-query-plugin-hook");
  });

  it("writes a plugin scaffold file from the CLI", async () => {
    const root = await tempDir("leflect-plugin-scaffold-");

    try {
      const configPath = path.join(root, "leflect.config.ts");
      await run([
        "scaffold-plugin",
        "--root",
        root,
        "--config",
        configPath,
        "--name",
        "account query",
        "--target",
        "common"
      ]);

      const pluginPath = path.join(root, "leflect", "plugins", "account-query-plugin.ts");
      const content = await readFile(pluginPath, "utf8");

      expect(content).toContain("export function accountQueryPlugin(): LeflectPlugin");
      expect(content).toContain("name: \"account-query-plugin\"");
      expect(content).toContain("target: \"common\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
