import path from "path";
import { writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { run } from "@leflect-java/cli";
import { cleanupWorkspace, createFixtureWorkspace, readJsonFile } from "@leflect-java/testkit";

describe("integration analyze", () => {
  it("runs the analysis pipeline over a fixture workspace", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");

    try {
      await writeFile(
        path.join(workspace.root, "leflect.config.json"),
        JSON.stringify({
          entryFiles: {
            java: ["UserService\\.java$"],
            jsp: ["customerEdit\\.jsp$"]
          }
        }, null, 2)
      );

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
      const fileDependencies = await readJsonFile<{
        files: Array<{
          path: string;
          dependantCount: number;
          referenceCount: number;
          references: Array<{ path: string }>;
          referencedBy: Array<{ path: string }>;
        }>;
      }>(path.join(workspace.analysisOut, "graph", "file-dependencies.json"));
      const entryDependencies = await readJsonFile<{
        matchedEntries: Array<{ path: string }>;
        entries: Array<{ entry: string; reachableFiles: string[] }>;
      }>(path.join(workspace.analysisOut, "graph", "entry-dependencies.json"));

      expect(summary.counts.classes).toBe(1);
      expect(summary.counts.jsps).toBe(1);
      expect(summary.jspImpacts[0]?.jspPath).toBe("web/customerEdit.jsp");
      expect(summary.jspImpacts[0]?.tagHandlers).toContain("FormTag");
      expect(summary.jspImpacts[0]?.javaTargets).toContain("UserService");
      expect(reverseIndex.handlerToJsp.FormTag).toEqual(["web/customerEdit.jsp"]);
      expect(fileDependencies.files).toEqual([
        {
          path: "src/UserService.java",
          nodeType: "java",
          dependantCount: 1,
          referenceCount: 0,
          references: [],
          referencedBy: [
            {
              path: "web/customerEdit.jsp",
              nodeType: "jsp",
              edgeTypes: ["JSP_SCRIPTLET_CALL"],
              symbols: ["web/customerEdit.jsp"]
            }
          ]
        },
        {
          path: "web/customerEdit.jsp",
          nodeType: "jsp",
          dependantCount: 0,
          referenceCount: 2,
          references: [
            {
              path: "FormTag",
              nodeType: "unresolved",
              edgeTypes: ["JSP_USES_TAG"],
              symbols: ["FormTag"]
            },
            {
              path: "src/UserService.java",
              nodeType: "java",
              edgeTypes: ["JSP_SCRIPTLET_CALL"],
              symbols: ["UserService"]
            }
          ],
          referencedBy: []
        }
      ]);
      expect(entryDependencies.matchedEntries).toEqual([
        { path: "src/UserService.java", nodeType: "java", matchedBy: ["UserService\\.java$"] },
        { path: "web/customerEdit.jsp", nodeType: "jsp", matchedBy: ["customerEdit\\.jsp$"] }
      ]);
      expect(entryDependencies.entries).toMatchObject([
        {
          entry: "src/UserService.java",
          nodeType: "java",
          matchedBy: ["UserService\\.java$"],
          nodeCount: 1,
          edgeCount: 0,
          reachableFiles: ["src/UserService.java"]
        },
        {
          entry: "web/customerEdit.jsp",
          nodeType: "jsp",
          matchedBy: ["customerEdit\\.jsp$"],
          nodeCount: 2,
          edgeCount: 2,
          reachableFiles: ["src/UserService.java", "web/customerEdit.jsp"]
        }
      ]);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});
