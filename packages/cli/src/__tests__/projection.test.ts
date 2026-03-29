import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { loadProjectionAstGraph } from "../projection-ast";
import {
  buildProjectionGraph,
  loadProjectionEntry,
  loadProjectionFileDetail,
  loadProjectionSnapshot,
  queryProjectionEntries,
  queryProjectionTreeChildren
} from "../projection";

describe("projection snapshot", () => {
  it("loads sharded index data and builds a focused dependency graph", async () => {
    const fixture = await createProjectionFixture();
    const snapshot = await loadProjectionSnapshot(fixture.analysisOut, "demo-project", fixture.root);

    expect(snapshot.files).toHaveLength(3);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.defaultEntryId).toBe("demo.home");
    expect(snapshot.entries[0]).toMatchObject({
      id: "demo.home",
      source: "declared",
      focusPath: "src/main/webapp/index.jsp",
      reachableCount: 2
    });
    expect(snapshot.files.find((entry) => entry.path === "src/main/java/demo/App.java")?.methodCount).toBe(2);

    const graph = buildProjectionGraph(snapshot, {
      focusPath: "src/main/java/demo/App.java",
      depth: 2,
      maxNodes: 20
    });
    expect(graph.direction).toBe("outbound");
    expect(graph.stats.nodes).toBe(2);
    expect(graph.stats.edges).toBe(1);
    expect(graph.edges).toEqual([
      {
        id: "src/main/java/demo/App.java->src/main/java/demo/Service.java",
        sourceId: "src/main/java/demo/App.java",
        targetId: "src/main/java/demo/Service.java",
        type: "JAVA_CALL",
        confidence: ["high"],
        symbols: ["demo.App#run()"]
      }
    ]);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/App.java")?.isFocus).toBe(true);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/Service.java")?.parentId).toBe("src/main/java/demo/App.java");

    const entryGraph = buildProjectionGraph(snapshot, {
      entryId: "demo.home",
      focusPath: "src/main/webapp/index.jsp",
      depth: 2,
      maxNodes: 20
    });
    expect(entryGraph.focusPath).toBe("entry:demo.home");
    expect(entryGraph.nodes.find((node) => node.id === "entry:demo.home")?.nodeType).toBe("entry");
    expect(entryGraph.nodes.find((node) => node.id === "src/main/webapp/index.jsp")?.parentId).toBe("entry:demo.home");
    expect(entryGraph.stats.edges).toBe(2);
    expect(entryGraph.edges.map((edge) => edge.id)).toEqual([
      "entry:demo.home->src/main/webapp/index.jsp",
      "src/main/webapp/index.jsp->src/main/java/demo/Service.java"
    ]);

    const detail = await loadProjectionFileDetail(snapshot, "src/main/webapp/index.jsp");
    expect(detail.file.nodeType).toBe("jsp");
    expect(detail.metadata?.["taglibs"]).toBeDefined();
    expect(detail.references[0].path).toBe("src/main/java/demo/Service.java");
    expect(detail.source?.language).toBe("jsp");
    expect(detail.source?.content).toContain("<%@ page");

    const javaAstGraph = await loadProjectionAstGraph(snapshot, {
      focusPath: "src/main/java/demo/App.java",
      includeExternal: true
    });
    expect(javaAstGraph.nodes.some((node) => node.astType === "ClassOrInterfaceDeclaration" && node.label === "App")).toBe(true);
    expect(javaAstGraph.nodes.some((node) => node.astType === "MethodCallExpr" && node.label === "work()")).toBe(true);
    expect(javaAstGraph.nodes.some((node) => node.external && node.path === "src/main/java/demo/Service.java")).toBe(true);
    expect(javaAstGraph.links.some((link) => link.type === "external")).toBe(true);

    const jspAstGraph = await loadProjectionAstGraph(snapshot, {
      focusPath: "src/main/webapp/index.jsp",
      includeExternal: true
    });
    expect(jspAstGraph.nodes.some((node) => node.astType === "JspScriptlet")).toBe(true);
    expect(jspAstGraph.nodes.some((node) => node.astType === "JspMethodCall" && node.label === "Service.work()")).toBe(true);
    expect(jspAstGraph.nodes.some((node) => node.external && node.path === "src/main/java/demo/Service.java")).toBe(true);

    const entryPage = queryProjectionEntries(snapshot, { offset: 0, limit: 1 });
    expect(entryPage.total).toBe(2);
    expect(entryPage.entries).toHaveLength(1);
    expect(entryPage.hasMore).toBe(true);

    expect(loadProjectionEntry(snapshot, { id: "demo.home" })?.label).toBe("Demo Home");
    expect(loadProjectionEntry(snapshot, { focusPath: "src/main/webapp/index.jsp" })?.id).toBe("demo.home");

    const classpathRoot = queryProjectionTreeChildren(snapshot, {
      mode: "classpath",
      nodeType: "all"
    });
    expect(classpathRoot.nodes.map((node) => node.id)).toEqual([
      "classpath:branch:demo",
      "classpath:branch:src"
    ]);

    const classpathJava = queryProjectionTreeChildren(snapshot, {
      mode: "classpath",
      parentId: "classpath:branch:demo",
      nodeType: "java"
    });
    expect(classpathJava.nodes.map((node) => node.label)).toEqual(["App.java", "Service.java"]);
  });

  it("walks the full graph without a depth limit and stops on cycles", () => {
    const graph = buildProjectionGraph(createCyclicSnapshot(), {
      focusPath: "src/main/java/demo/A.java",
      maxNodes: 20
    });

    expect(graph.depth).toBe(0);
    expect(graph.truncated).toBe(false);
    expect(graph.stats.nodes).toBe(3);
    expect(graph.stats.edges).toBe(3);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "src/main/java/demo/A.java",
      "src/main/java/demo/B.java",
      "src/main/java/demo/C.java"
    ]);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/B.java")?.parentId).toBe(
      "src/main/java/demo/A.java"
    );
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/C.java")?.parentId).toBe(
      "src/main/java/demo/B.java"
    );
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "src/main/java/demo/A.java->src/main/java/demo/B.java",
      "src/main/java/demo/B.java->src/main/java/demo/C.java",
      "src/main/java/demo/C.java->src/main/java/demo/A.java"
    ]);
  });

  it("keeps multi-parent edges for shared dependencies", () => {
    const graph = buildProjectionGraph(createSharedDependencySnapshot(), {
      focusPath: "src/main/java/demo/A.java",
      maxNodes: 20
    });

    expect(graph.stats.nodes).toBe(3);
    expect(graph.stats.edges).toBe(3);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/C.java")?.parentId).toBe(
      "src/main/java/demo/A.java"
    );
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "src/main/java/demo/A.java->src/main/java/demo/B.java",
      "src/main/java/demo/A.java->src/main/java/demo/C.java",
      "src/main/java/demo/B.java->src/main/java/demo/C.java"
    ]);
  });

  it("filters dependency graphs by edge kind", () => {
    const importGraph = buildProjectionGraph(createEdgeKindSnapshot(), {
      focusPath: "src/main/java/demo/A.java",
      maxNodes: 20,
      edgeKinds: ["import"]
    });
    expect(importGraph.nodes.map((node) => node.id)).toEqual([
      "src/main/java/demo/A.java",
      "java.util.List"
    ]);
    expect(importGraph.edges.map((edge) => edge.type)).toEqual(["JAVA_IMPORT"]);

    const typeGraph = buildProjectionGraph(createEdgeKindSnapshot(), {
      focusPath: "src/main/java/demo/A.java",
      maxNodes: 20,
      edgeKinds: ["type"]
    });
    expect(typeGraph.nodes.map((node) => node.id)).toEqual([
      "src/main/java/demo/A.java",
      "java.io.IOException",
      "java.util.ArrayList"
    ]);
    expect(typeGraph.edges.map((edge) => edge.type)).toEqual([
      "JAVA_TYPE_REFERENCE",
      "JAVA_NEW"
    ]);
  });
});

function createCyclicSnapshot() {
  const files = [
    {
      path: "src/main/java/demo/A.java",
      nodeType: "java",
      referenceCount: 1,
      dependantCount: 1,
      references: [],
      referencedBy: []
    },
    {
      path: "src/main/java/demo/B.java",
      nodeType: "java",
      referenceCount: 1,
      dependantCount: 1,
      references: [],
      referencedBy: []
    },
    {
      path: "src/main/java/demo/C.java",
      nodeType: "java",
      referenceCount: 1,
      dependantCount: 1,
      references: [],
      referencedBy: []
    }
  ];
  const adjacency = new Map([
    [
      "src/main/java/demo/A.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/B.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/B.java",
      [
        {
          from: "src/main/java/demo/B.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/C.java",
      [
        {
          from: "src/main/java/demo/C.java",
          to: "src/main/java/demo/A.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ]
  ]);
  const reverseAdjacency = new Map([
    [
      "src/main/java/demo/A.java",
      [
        {
          from: "src/main/java/demo/C.java",
          to: "src/main/java/demo/A.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/B.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/B.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/C.java",
      [
        {
          from: "src/main/java/demo/B.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ]
  ]);

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.path, file])),
    entryGraphsById: new Map(),
    adjacency,
    reverseAdjacency
  } as unknown as Parameters<typeof buildProjectionGraph>[0];
}

function createSharedDependencySnapshot() {
  const files = [
    {
      path: "src/main/java/demo/A.java",
      nodeType: "java",
      referenceCount: 2,
      dependantCount: 0,
      references: [],
      referencedBy: []
    },
    {
      path: "src/main/java/demo/B.java",
      nodeType: "java",
      referenceCount: 1,
      dependantCount: 1,
      references: [],
      referencedBy: []
    },
    {
      path: "src/main/java/demo/C.java",
      nodeType: "java",
      referenceCount: 0,
      dependantCount: 2,
      references: [],
      referencedBy: []
    }
  ];
  const adjacency = new Map([
    [
      "src/main/java/demo/A.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/B.java",
          type: "JAVA_CALL",
          confidence: "high"
        },
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_IMPORT",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/B.java",
      [
        {
          from: "src/main/java/demo/B.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ]
  ]);
  const reverseAdjacency = new Map([
    [
      "src/main/java/demo/B.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/B.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ],
    [
      "src/main/java/demo/C.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_IMPORT",
          confidence: "high"
        },
        {
          from: "src/main/java/demo/B.java",
          to: "src/main/java/demo/C.java",
          type: "JAVA_CALL",
          confidence: "high"
        }
      ]
    ]
  ]);

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.path, file])),
    entryGraphsById: new Map(),
    adjacency,
    reverseAdjacency
  } as unknown as Parameters<typeof buildProjectionGraph>[0];
}

function createEdgeKindSnapshot() {
  const files = [
    {
      path: "src/main/java/demo/A.java",
      nodeType: "java",
      referenceCount: 3,
      dependantCount: 0,
      references: [],
      referencedBy: []
    }
  ];
  const adjacency = new Map([
    [
      "src/main/java/demo/A.java",
      [
        {
          from: "src/main/java/demo/A.java",
          to: "java.util.List",
          type: "JAVA_IMPORT",
          confidence: "high"
        },
        {
          from: "src/main/java/demo/A.java",
          to: "java.io.IOException",
          type: "JAVA_TYPE_REFERENCE",
          confidence: "high"
        },
        {
          from: "src/main/java/demo/A.java",
          to: "java.util.ArrayList",
          type: "JAVA_NEW",
          confidence: "high"
        }
      ]
    ]
  ]);

  return {
    files,
    filesByPath: new Map(files.map((file) => [file.path, file])),
    entryGraphsById: new Map(),
    adjacency,
    reverseAdjacency: new Map()
  } as unknown as Parameters<typeof buildProjectionGraph>[0];
}

async function createProjectionFixture(): Promise<{ root: string; analysisOut: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "leflect-projection-"));
  const analysisOut = path.join(root, "analysis");
  await mkdir(path.join(analysisOut, "graph"), { recursive: true });
  await mkdir(path.join(analysisOut, "index", "java", "src", "main", "java", "demo"), { recursive: true });
  await mkdir(path.join(analysisOut, "index", "jsp", "src", "main", "webapp"), { recursive: true });
  await mkdir(path.join(analysisOut, "java-ast", "src", "main", "java", "demo"), { recursive: true });
  await mkdir(path.join(analysisOut, "report"), { recursive: true });
  await mkdir(path.join(root, "src", "main", "java", "demo"), { recursive: true });
  await mkdir(path.join(root, "src", "main", "webapp"), { recursive: true });

  await writeJson(path.join(analysisOut, "report", "summary.json"), {
    schemaVersion: "1.0",
    generatedAt: new Date(0).toISOString(),
    counts: { classes: 2, methods: 3, jsps: 1, taglibs: 1, javaCallEdges: 1, jspJavaEdges: 1, unresolvedEdges: 0 },
    labels: {
      classes: { SERVICE: 1, DAO: 0, CONTROLLER: 0, TAG_HANDLER: 0, UTIL: 0, DTO: 0, UNKNOWN: 1 },
      methods: { SERVICE_METHOD: 1, TAG_ENTRYPOINT: 0, ACCESSOR: 0, UNKNOWN: 2 },
      jsps: { PAGE: 1, FRAGMENT: 0, AJAX_VIEW: 0, UNKNOWN: 0 }
    },
    jspImpacts: []
  });

  await writeJson(path.join(analysisOut, "graph", "file-dependencies.json"), {
    schemaVersion: "1.0",
    generatedAt: new Date(0).toISOString(),
    files: [
      {
        path: "src/main/java/demo/App.java",
        nodeType: "java",
        referenceCount: 1,
        dependantCount: 0,
        references: [{ path: "src/main/java/demo/Service.java", nodeType: "java", edgeTypes: ["JAVA_CALL"], symbols: ["demo.App#run()"] }],
        referencedBy: []
      },
      {
        path: "src/main/java/demo/Service.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 2,
        references: [],
        referencedBy: [
          { path: "src/main/java/demo/App.java", nodeType: "java", edgeTypes: ["JAVA_CALL"], symbols: ["demo.Service#work()"] },
          { path: "src/main/webapp/index.jsp", nodeType: "jsp", edgeTypes: ["JSP_SCRIPTLET_CALL"], symbols: ["demo.Service"] }
        ]
      },
      {
        path: "src/main/webapp/index.jsp",
        nodeType: "jsp",
        referenceCount: 1,
        dependantCount: 0,
        references: [{ path: "src/main/java/demo/Service.java", nodeType: "java", edgeTypes: ["JSP_SCRIPTLET_CALL"], symbols: ["demo.Service"] }],
        referencedBy: []
      }
    ]
  });

  await writeFile(
    path.join(analysisOut, "graph", "file-dependency.jsonl"),
    [
      JSON.stringify({ from: "src/main/java/demo/App.java", to: "src/main/java/demo/Service.java", type: "JAVA_CALL", confidence: "high", fromSymbol: "demo.App#run()" }),
      JSON.stringify({ from: "src/main/webapp/index.jsp", to: "src/main/java/demo/Service.java", type: "JSP_SCRIPTLET_CALL", confidence: "medium", fromSymbol: "work" })
    ].join("\n") + "\n"
  );

  await writeJson(path.join(analysisOut, "graph", "entry-dependencies.json"), {
    schemaVersion: "1.0",
    generatedAt: new Date(0).toISOString(),
    patterns: {
      java: [],
      jsp: ["index\\.jsp$"]
    },
    matchedEntries: [
      {
        path: "src/main/webapp/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"]
      }
    ],
    unmatchedPatterns: [],
    entries: [
      {
        entry: "src/main/webapp/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"],
        nodeCount: 2,
        edgeCount: 1,
        reachableFiles: ["src/main/webapp/index.jsp", "src/main/java/demo/Service.java"],
        edges: [
          {
            from: "src/main/webapp/index.jsp",
            to: "src/main/java/demo/Service.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "medium"
          }
        ]
      }
    ],
    declaredEntries: [
      {
        id: "demo.home",
        type: "virtual_page",
        label: "Demo Home",
        description: "Demo entry",
        tags: ["sample"],
        seeds: {
          java: [],
          jsp: [
            {
              targetType: "jsp",
              value: "src/main/webapp/index.jsp",
              matched: true,
              path: "src/main/webapp/index.jsp",
              nodeType: "jsp"
            }
          ]
        },
        deferredTargets: [],
        nodeCount: 2,
        edgeCount: 1,
        reachableFiles: ["src/main/webapp/index.jsp", "src/main/java/demo/Service.java"],
        edges: [
          {
            from: "src/main/webapp/index.jsp",
            to: "src/main/java/demo/Service.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "medium"
          }
        ]
      }
    ]
  });

  await writeJson(path.join(analysisOut, "index", "java-files.json"), [
    {
      path: "src/main/java/demo/App.java",
      sourceKind: "java",
      packageName: "demo",
      metadataPath: "java/src/main/java/demo/App.java.json",
      importCount: 1,
      classCount: 1,
      methodCount: 2,
      callCount: 1,
      classReferenceCount: 1
    },
    {
      path: "src/main/java/demo/Service.java",
      sourceKind: "java",
      packageName: "demo",
      metadataPath: "java/src/main/java/demo/Service.java.json",
      importCount: 0,
      classCount: 1,
      methodCount: 1,
      callCount: 0,
      classReferenceCount: 0
    }
  ]);

  await writeJson(path.join(analysisOut, "index", "jsp-files.json"), [
    {
      path: "src/main/webapp/index.jsp",
      metadataPath: "jsp/src/main/webapp/index.jsp.json",
      importCount: 0,
      includeCount: 0,
      taglibCount: 1,
      tagCount: 1,
      scriptletCount: 1,
      resolvedTagCount: 0,
      classReferenceCount: 0,
      methodCallCount: 1,
      ast: { mode: "lightweight" }
    }
  ]);

  await writeJson(path.join(analysisOut, "index", "java", "src", "main", "java", "demo", "App.java.json"), {
    path: "src/main/java/demo/App.java",
    imports: ["demo.Service"],
    importIds: ["java-import:src/main/java/demo/App.java:demo.Service"],
    classIds: ["demo.App"],
    methodIds: ["demo.App#run()", "demo.App#main(String[])"],
    callTargets: ["demo.Service#work()"],
    importEntries: [{ id: "java-import:src/main/java/demo/App.java:demo.Service", file: "src/main/java/demo/App.java", import: "demo.Service" }],
    classes: [{ id: "demo.App", name: "App", file: "src/main/java/demo/App.java" }],
    methods: [
      { id: "demo.App#run()", name: "run", classId: "demo.App", file: "src/main/java/demo/App.java" },
      { id: "demo.App#main(String[])", name: "main", classId: "demo.App", file: "src/main/java/demo/App.java" }
    ],
    calls: [{ from: "demo.App#run()", to: "demo.Service#work()", fromFile: "src/main/java/demo/App.java", toFile: "src/main/java/demo/Service.java", methodName: "work", location: { line: 5, column: 5, endLine: 5, endColumn: 18 }, toMethodId: "demo.Service#work()" }],
    classReferences: [{ file: "src/main/java/demo/App.java", className: "demo.Service", classPath: "demo.Service", kind: "import" }]
  });

  await writeJson(path.join(analysisOut, "index", "java", "src", "main", "java", "demo", "Service.java.json"), {
    path: "src/main/java/demo/Service.java",
    imports: [],
    importIds: [],
    classIds: ["demo.Service"],
    methodIds: ["demo.Service#work()"],
    callTargets: [],
    importEntries: [],
    classes: [{ id: "demo.Service", name: "Service", file: "src/main/java/demo/Service.java" }],
    methods: [{ id: "demo.Service#work()", name: "work", classId: "demo.Service", file: "src/main/java/demo/Service.java" }],
    calls: [],
    classReferences: []
  });

  await writeJson(path.join(analysisOut, "index", "jsp", "src", "main", "webapp", "index.jsp.json"), {
    path: "src/main/webapp/index.jsp",
    imports: [],
    importIds: [],
    includes: [],
    taglibCount: 1,
    tagCount: 1,
    scriptletCount: 1,
    resolvedTagCount: 0,
    taglibs: [{ file: "src/main/webapp/index.jsp", prefix: "c", uri: "http://java.sun.com/jsp/jstl/core" }],
    tags: [{ file: "src/main/webapp/index.jsp", prefix: "c", name: "out", raw: "<c:out>" }],
    scriptlets: [{ file: "src/main/webapp/index.jsp", kind: "scriptlet", code: "service.work();" }],
    importEntries: [],
    classReferences: [],
    methodCalls: [{ file: "src/main/webapp/index.jsp", methodName: "work", classPath: "demo.Service", location: { line: 4, column: 4, endLine: 4, endColumn: 18 } }]
  });

  await writeJson(path.join(analysisOut, "java-ast", "src", "main", "java", "demo", "App.java.json"), {
    "!": "com.github.javaparser.ast.CompilationUnit",
    range: { beginLine: 1, beginColumn: 1, endLine: 7, endColumn: 1 },
    types: [
      {
        "!": "com.github.javaparser.ast.body.ClassOrInterfaceDeclaration",
        range: { beginLine: 3, beginColumn: 1, endLine: 7, endColumn: 1 },
        name: { identifier: "App" },
        members: [
          {
            "!": "com.github.javaparser.ast.body.MethodDeclaration",
            range: { beginLine: 4, beginColumn: 3, endLine: 6, endColumn: 3 },
            name: { identifier: "run" },
            parameters: [{ "!": "com.github.javaparser.ast.body.Parameter", range: { beginLine: 4, beginColumn: 12, endLine: 4, endColumn: 26 }, name: { identifier: "service" } }],
            body: {
              "!": "com.github.javaparser.ast.stmt.BlockStmt",
              range: { beginLine: 4, beginColumn: 29, endLine: 6, endColumn: 3 },
              statements: [
                {
                  "!": "com.github.javaparser.ast.stmt.ExpressionStmt",
                  range: { beginLine: 5, beginColumn: 5, endLine: 5, endColumn: 20 },
                  expression: {
                    "!": "com.github.javaparser.ast.expr.MethodCallExpr",
                    range: { beginLine: 5, beginColumn: 5, endLine: 5, endColumn: 18 },
                    name: { identifier: "work" },
                    scope: { "!": "com.github.javaparser.ast.expr.NameExpr", range: { beginLine: 5, beginColumn: 5, endLine: 5, endColumn: 11 }, name: { identifier: "service" } },
                    arguments: []
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  });

  await writeJson(path.join(analysisOut, "java-ast", "src", "main", "java", "demo", "Service.java.json"), {
    "!": "com.github.javaparser.ast.CompilationUnit",
    range: { beginLine: 1, beginColumn: 1, endLine: 5, endColumn: 1 },
    types: [
      {
        "!": "com.github.javaparser.ast.body.ClassOrInterfaceDeclaration",
        range: { beginLine: 3, beginColumn: 1, endLine: 5, endColumn: 1 },
        name: { identifier: "Service" },
        members: [
          {
            "!": "com.github.javaparser.ast.body.MethodDeclaration",
            range: { beginLine: 4, beginColumn: 3, endLine: 4, endColumn: 17 },
            name: { identifier: "work" },
            parameters: []
          }
        ]
      }
    ]
  });

  await writeFile(
    path.join(root, "src", "main", "java", "demo", "App.java"),
    [
      "package demo;",
      "",
      "public class App {",
      "  void run(Service service) {",
      "    service.work();",
      "  }",
      "}"
    ].join("\n")
  );
  await writeFile(
    path.join(root, "src", "main", "java", "demo", "Service.java"),
    [
      "package demo;",
      "",
      "public class Service {",
      "  void work() {}",
      "}"
    ].join("\n")
  );
  await writeFile(
    path.join(root, "src", "main", "webapp", "index.jsp"),
    [
      "<%@ page language=\"java\" %>",
      "<html>",
      "<body>",
      "<% service.work(); %>",
      "</body>",
      "</html>"
    ].join("\n")
  );

  return { root, analysisOut };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}
