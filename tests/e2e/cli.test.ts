import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "@lefectjava/cli";
import { cleanupWorkspace, createFixtureWorkspace, exists } from "@lefectjava/testkit";

describe("cli e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints report and query output for a fixture", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ""));
    });

    try {
      await run([
        "analyze",
        "--root",
        workspace.root,
        "--out",
        workspace.analysisOut,
        "--jsp-ast-mode",
        "lightweight",
        "--incremental"
      ]);

      await run([
        "query",
        "tag-usages",
        "--analysis",
        workspace.analysisOut,
        "--class",
        "FormTag"
      ]);

      expect(await exists(path.join(workspace.analysisOut, "report", "summary.json"))).toBe(true);
      expect(logSpy).toHaveBeenCalled();
      expect(logs.some((line) => line.includes("Tag handler: FormTag"))).toBe(true);
      expect(
        logs.some(
          (line) =>
            line.includes("Java parse skipped") || line.includes("Java AST parse complete")
        )
      ).toBe(true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});
