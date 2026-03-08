import path from "path";

import { describe, expect, it } from "vitest";

import { run } from "@lefectjava/cli";
import { cleanupWorkspace, createFixtureWorkspace, readJsonFile } from "@lefectjava/testkit";

describe("integration analyze", () => {
  it("runs the analysis pipeline over a fixture workspace", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");

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

      const summary = await readJsonFile<{
        counts: { classes: number; jsps: number };
        jspImpacts: Array<{ jspPath: string; tagHandlers: string[]; javaTargets: string[] }>;
      }>(path.join(workspace.analysisOut, "report", "summary.json"));
      const reverseIndex = await readJsonFile<{ handlerToJsp: Record<string, string[]> }>(
        path.join(workspace.analysisOut, "index", "reverse-index.json")
      );

      expect(summary.counts.classes).toBe(1);
      expect(summary.counts.jsps).toBe(1);
      expect(summary.jspImpacts[0]?.jspPath).toBe("web/customerEdit.jsp");
      expect(summary.jspImpacts[0]?.tagHandlers).toContain("FormTag");
      expect(summary.jspImpacts[0]?.javaTargets).toContain("UserService");
      expect(reverseIndex.handlerToJsp.FormTag).toEqual(["web/customerEdit.jsp"]);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});
