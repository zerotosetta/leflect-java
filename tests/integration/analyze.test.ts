import path from "path";
import { writeFile } from "fs/promises";

import { describe, expect, it, vi } from "vitest";

import { analyzeWorkspace, run } from "@leflect-java/cli";
import { cleanupWorkspace, createFixtureWorkspace, exists, readJsonFile } from "@leflect-java/testkit";

describe("integration analyze", () => {
  it("runs the analysis pipeline over a fixture workspace", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");

    try {
      await writeFile(
        path.join(workspace.root, "leflect.config.ts"),
        [
          "import { defineConfig } from \"@leflect-java/core\";",
          "",
          "export default defineConfig({",
          "  entryFiles: {",
          "    java: [\"UserService\\\\.java$\"],",
          "    jsp: [\"customerEdit\\\\.jsp$\"]",
          "  },",
          "  jsp: {",
          "    astMode: \"lightweight\",",
          "    taglibResolvers: {",
          "      \"/WEB-INF/form.tld#form\": ({ tag }) => ({",
          "        kind: \"QueryNode\",",
          "        raw: tag.raw,",
          "        lineRange: tag.lineRange,",
          "        queryId: \"form.render\",",
          "        statement: tag.bodyText,",
          "        sourceTag: tag",
          "      })",
          "    }",
          "  }",
          "});",
          ""
        ].join("\n")
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
      const taglibRegistry = await readJsonFile<Array<{ uri?: string; sourceKind?: string }>>(
        path.join(workspace.analysisOut, "index", "taglib-registry.json")
      );
      const jspFiles = await readJsonFile<Array<{
        path: string;
        semanticAstPath?: string;
        semanticNodeCount?: number;
        semanticQueryCount?: number;
      }>>(
        path.join(workspace.analysisOut, "index", "jsp-files.json")
      );
      const semanticAst = await readJsonFile<{
        semanticSummary: { queryCount: number };
        root: { children: Array<{ kind: string }> };
      }>(
        path.join(workspace.analysisOut, "jsp-semantic", "web", "customerEdit.jsp.json")
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
      const javaMetadata = await readJsonFile<{
        methods: Array<{
          id: string;
          orderedSteps?: Array<{ kind: string; branchPath?: string[]; lineRange?: { startLine?: number } }>;
          lineRange?: { startLine?: number; endLine?: number };
        }>;
      }>(path.join(workspace.analysisOut, "index", "java", "src", "UserService.java.json"));

      expect(summary.counts.classes).toBe(1);
      expect(summary.counts.jsps).toBe(1);
      expect(summary.jspImpacts[0]?.jspPath).toBe("web/customerEdit.jsp");
      expect(summary.jspImpacts[0]?.tagHandlers).toContain("FormTag");
      expect(summary.jspImpacts[0]?.javaTargets).toContain("UserService");
      expect(taglibRegistry[0]).toMatchObject({
        uri: "/WEB-INF/form.tld",
        sourceKind: "repo"
      });
      expect(jspFiles[0]).toMatchObject({
        path: "web/customerEdit.jsp",
        semanticAstPath: "jsp-semantic/web/customerEdit.jsp.json",
        semanticNodeCount: expect.any(Number),
        semanticQueryCount: 1
      });
      expect(semanticAst.semanticSummary.queryCount).toBe(1);
      expect(semanticAst.root.children).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "QueryNode"
        })
      ]));
      expect(reverseIndex.handlerToJsp.FormTag).toEqual(["web/customerEdit.jsp"]);
      const userServiceFile = fileDependencies.files.find((entry) => entry.path === "src/UserService.java");
      const jspFile = fileDependencies.files.find((entry) => entry.path === "web/customerEdit.jsp");

      expect(userServiceFile).toMatchObject({
        path: "src/UserService.java",
        nodeType: "java",
        dependantCount: 1
      });
      expect(userServiceFile?.referencedBy).toEqual(expect.arrayContaining([
        {
          path: "web/customerEdit.jsp",
          nodeType: "jsp",
          edgeTypes: ["JSP_SCRIPTLET_CALL"],
          symbols: ["web/customerEdit.jsp"]
        }
      ]));
      expect(jspFile).toMatchObject({
        path: "web/customerEdit.jsp",
        nodeType: "jsp",
        dependantCount: 0
      });
      expect(jspFile?.references).toEqual(expect.arrayContaining([
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
      ]));
      expect(entryDependencies.matchedEntries).toEqual([
        { path: "src/UserService.java", nodeType: "java", matchedBy: ["UserService\\.java$"] },
        { path: "web/customerEdit.jsp", nodeType: "jsp", matchedBy: ["customerEdit\\.jsp$"] }
      ]);
      expect(entryDependencies.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entry: "src/UserService.java",
          nodeType: "java",
          matchedBy: ["UserService\\.java$"],
          nodeCount: 1,
          reachableFiles: ["src/UserService.java"]
        }),
        expect.objectContaining({
          entry: "web/customerEdit.jsp",
          nodeType: "jsp",
          matchedBy: ["customerEdit\\.jsp$"],
          nodeCount: 2,
          reachableFiles: ["src/UserService.java", "web/customerEdit.jsp"]
        })
      ]));
      expect(await exists(path.join(workspace.analysisOut, "index", "java", "src", "UserService.java.json"))).toBe(true);
      expect(javaMetadata.methods[0]?.lineRange).toMatchObject({
        startLine: 2,
        endLine: 4
      });
      if (javaMetadata.methods[0]?.orderedSteps) {
        expect(javaMetadata.methods[0].orderedSteps).toEqual([
          expect.objectContaining({
            kind: "return",
            branchPath: [],
            lineRange: expect.objectContaining({ startLine: 3 })
          })
        ]);
      }
      expect(await exists(path.join(workspace.analysisOut, "index", "jsp", "web", "customerEdit.jsp.json"))).toBe(true);
      expect(await exists(path.join(workspace.analysisOut, "index", "taglib-registry.json"))).toBe(true);
      expect(await exists(path.join(workspace.analysisOut, "jsp-semantic", "web", "customerEdit.jsp.json"))).toBe(true);
      expect(await exists(path.join(workspace.analysisOut, "index", "classes.json"))).toBe(false);
      expect(await exists(path.join(workspace.analysisOut, "index", "methods.json"))).toBe(false);
      expect(await exists(path.join(workspace.analysisOut, "index", "calls.json"))).toBe(false);
      expect(await exists(path.join(workspace.analysisOut, "index", "jsp-docs.json"))).toBe(false);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });

  it("returns the same summary through analyzeWorkspace and CLI analyze", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ""));
    });

    try {
      const apiResult = await analyzeWorkspace({
        root: workspace.root,
        analysisOut: workspace.analysisOut,
        jspAstMode: "lightweight",
        incremental: true
      });

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
      expect(JSON.parse(logs[0])).toMatchObject({
        ...apiResult.reports.summary,
        generatedAt: expect.any(String)
      });
    } finally {
      logSpy.mockRestore();
      await cleanupWorkspace(workspace);
    }
  });
});
