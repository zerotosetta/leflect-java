import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "@leflect-java/cli";
import { cleanupWorkspace, createFixtureWorkspace, exists } from "@leflect-java/testkit";

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

  it("supports quiet and machine-readable analyze output", async () => {
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
        "--incremental",
        "--quiet"
      ]);

      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]).counts.jsps).toBe(1);

      logs.length = 0;

      await run([
        "analyze",
        "--root",
        workspace.root,
        "--out",
        workspace.analysisOut,
        "--jsp-ast-mode",
        "lightweight",
        "--incremental",
        "--format",
        "json"
      ]);

      expect(logs).toHaveLength(1);
      const payload = JSON.parse(logs[0]) as {
        analysisOut: string;
        worker: { requested: boolean };
        stages: Array<{ stage: string }>;
        reports: { summary: { counts: { jsps: number } } };
      };
      expect(payload.analysisOut).toBe(workspace.analysisOut);
      expect(payload.worker.requested).toBe(true);
      expect(payload.stages.map((stage) => stage.stage)).toContain("report-summary");
      expect(payload.reports.summary.counts.jsps).toBe(1);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});
