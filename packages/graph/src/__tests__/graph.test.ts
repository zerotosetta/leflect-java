import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildGraphs, writeGraphFiles } from "../index";

describe("graph", () => {
  it("builds java and jsp graph edges", () => {
    const result = buildGraphs(
      [{
        from: "a.A#run()",
        to: "b.B#save()",
        fromClassId: "a.A",
        toClassId: "b.B",
        fromMethodId: "a.A#run()",
        toMethodId: "b.B#save()",
        fromFile: "src/a/A.java"
      }],
      [
        {
          path: "view/index.jsp",
          scriptlets: [{ kind: "scriptlet", code: "new UserService().findUser();" }],
          resolvedTags: [{ prefix: "c", name: "form", handlerClass: "com.example.FormTag" }]
        }
      ],
      [
        { id: "a.A", name: "A", file: "src/a/A.java" },
        { id: "b.B", name: "B", file: "src/b/B.java" },
        { id: "com.example.UserService", name: "UserService", file: "src/service/UserService.java" },
        { id: "com.example.FormTag", name: "FormTag", file: "src/tag/FormTag.java" }
      ],
      {
        entryFiles: {
          java: ["A\\.java$"],
          jsp: ["index\\.jsp$"]
        }
      }
    );

    expect(result.javaCallEdges[0]).toEqual({
      from: "a.A",
      to: "b.B",
      type: "JAVA_CALL",
      confidence: "high",
      fromFile: "src/a/A.java",
      toFile: "src/b/B.java",
      fromSymbol: "a.A#run()",
      toSymbol: "b.B#save()"
    });
    expect(result.jspJavaEdges).toEqual([
      {
        from: "view/index.jsp",
        to: "com.example.UserService",
        type: "JSP_SCRIPTLET_CALL",
        confidence: "low",
        fromFile: "view/index.jsp",
        toFile: "src/service/UserService.java",
        toSymbol: "com.example.UserService"
      },
      {
        from: "view/index.jsp",
        to: "com.example.FormTag",
        type: "JSP_USES_TAG",
        confidence: "high",
        fromFile: "view/index.jsp",
        toFile: "src/tag/FormTag.java",
        toSymbol: "com.example.FormTag"
      }
    ]);
    expect(result.fileDependencies.files).toEqual([
      {
        path: "src/a/A.java",
        nodeType: "java",
        referenceCount: 1,
        dependantCount: 0,
        references: [
          {
            path: "src/b/B.java",
            nodeType: "java",
            edgeTypes: ["JAVA_CALL"],
            symbols: ["b.B#save()"]
          }
        ],
        referencedBy: []
      },
      {
        path: "src/b/B.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "src/a/A.java",
            nodeType: "java",
            edgeTypes: ["JAVA_CALL"],
            symbols: ["a.A#run()"]
          }
        ]
      },
      {
        path: "src/service/UserService.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "view/index.jsp",
            nodeType: "jsp",
            edgeTypes: ["JSP_SCRIPTLET_CALL"],
            symbols: ["view/index.jsp"]
          }
        ]
      },
      {
        path: "src/tag/FormTag.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "view/index.jsp",
            nodeType: "jsp",
            edgeTypes: ["JSP_USES_TAG"],
            symbols: ["view/index.jsp"]
          }
        ]
      },
      {
        path: "view/index.jsp",
        nodeType: "jsp",
        referenceCount: 2,
        dependantCount: 0,
        references: [
          {
            path: "src/service/UserService.java",
            nodeType: "java",
            edgeTypes: ["JSP_SCRIPTLET_CALL"],
            symbols: ["com.example.UserService"]
          },
          {
            path: "src/tag/FormTag.java",
            nodeType: "java",
            edgeTypes: ["JSP_USES_TAG"],
            symbols: ["com.example.FormTag"]
          }
        ],
        referencedBy: []
      }
    ]);
    expect(result.entryDependencies.matchedEntries).toEqual([
      {
        path: "src/a/A.java",
        nodeType: "java",
        matchedBy: ["A\\.java$"]
      },
      {
        path: "view/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"]
      }
    ]);
    expect(result.entryDependencies.entries).toEqual([
      {
        entry: "src/a/A.java",
        nodeType: "java",
        matchedBy: ["A\\.java$"],
        nodeCount: 2,
        edgeCount: 1,
        reachableFiles: ["src/a/A.java", "src/b/B.java"],
        edges: [
          {
            from: "src/a/A.java",
            to: "src/b/B.java",
            type: "JAVA_CALL",
            confidence: "high",
            fromFile: "src/a/A.java",
            toFile: "src/b/B.java",
            fromSymbol: "a.A#run()",
            toSymbol: "b.B#save()"
          }
        ]
      },
      {
        entry: "view/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"],
        nodeCount: 3,
        edgeCount: 2,
        reachableFiles: ["src/service/UserService.java", "src/tag/FormTag.java", "view/index.jsp"],
        edges: [
          {
            from: "view/index.jsp",
            to: "src/service/UserService.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "low",
            fromFile: "view/index.jsp",
            toFile: "src/service/UserService.java",
            toSymbol: "com.example.UserService"
          },
          {
            from: "view/index.jsp",
            to: "src/tag/FormTag.java",
            type: "JSP_USES_TAG",
            confidence: "high",
            fromFile: "view/index.jsp",
            toFile: "src/tag/FormTag.java",
            toSymbol: "com.example.FormTag"
          }
        ]
      }
    ]);
  });

  it("writes graph jsonl files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-graph-"));

    await writeGraphFiles(root, {
      javaCallEdges: [{ from: "a", to: "b", type: "JAVA_CALL", confidence: "high" }],
      jspJavaEdges: [{ from: "jsp", to: "handler", type: "JSP_USES_TAG", confidence: "high" }],
      fileEdges: [{ from: "src/A.java", to: "src/B.java", type: "JAVA_CALL", confidence: "high" }],
      fileDependencies: {
        schemaVersion: "1.0",
        generatedAt: "2026-03-08T00:00:00.000Z",
        files: []
      },
      entryDependencies: {
        schemaVersion: "1.0",
        generatedAt: "2026-03-08T00:00:00.000Z",
        patterns: { java: [], jsp: [] },
        matchedEntries: [],
        unmatchedPatterns: [],
        entries: []
      }
    });

    const javaCall = await readFile(path.join(root, "graph", "java-call.jsonl"), "utf8");
    const jspJava = await readFile(path.join(root, "graph", "jsp-java.jsonl"), "utf8");
    const fileDependency = await readFile(path.join(root, "graph", "file-dependency.jsonl"), "utf8");
    const fileDependencies = await readFile(path.join(root, "graph", "file-dependencies.json"), "utf8");
    const entryDependencies = await readFile(path.join(root, "graph", "entry-dependencies.json"), "utf8");

    expect(javaCall).toContain("\"JAVA_CALL\"");
    expect(jspJava).toContain("\"JSP_USES_TAG\"");
    expect(fileDependency).toContain("\"src/A.java\"");
    expect(fileDependencies).toContain("\"schemaVersion\": \"1.0\"");
    expect(entryDependencies).toContain("\"patterns\"");
  });
});
