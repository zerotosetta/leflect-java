import os from "os";
import path from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildProjectionGraph, loadProjectionFileDetail, loadProjectionSnapshot } from "../projection";

describe("projection snapshot", () => {
  it("loads sharded index data and builds a focused dependency graph", async () => {
    const analysisOut = await createProjectionFixture();
    const snapshot = await loadProjectionSnapshot(analysisOut, "demo-project");

    expect(snapshot.files).toHaveLength(3);
    expect(snapshot.files.find((entry) => entry.path === "src/main/java/demo/App.java")?.methodCount).toBe(2);

    const graph = buildProjectionGraph(snapshot, "src/main/java/demo/App.java", 2, 20);
    expect(graph.direction).toBe("outbound");
    expect(graph.stats.nodes).toBe(2);
    expect(graph.stats.edges).toBe(1);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/App.java")?.isFocus).toBe(true);
    expect(graph.nodes.find((node) => node.id === "src/main/java/demo/Service.java")?.parentId).toBe("src/main/java/demo/App.java");

    const detail = await loadProjectionFileDetail(snapshot, "src/main/webapp/index.jsp");
    expect(detail.file.nodeType).toBe("jsp");
    expect(detail.metadata?.["taglibs"]).toBeDefined();
    expect(detail.references[0].path).toBe("src/main/java/demo/Service.java");
  });
});

async function createProjectionFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "leflect-projection-"));
  const analysisOut = path.join(root, "analysis");
  await mkdir(path.join(analysisOut, "graph"), { recursive: true });
  await mkdir(path.join(analysisOut, "index", "java", "src", "main", "java", "demo"), { recursive: true });
  await mkdir(path.join(analysisOut, "index", "jsp", "src", "main", "webapp"), { recursive: true });
  await mkdir(path.join(analysisOut, "report"), { recursive: true });

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
          { path: "src/main/java/demo/App.java", nodeType: "java", edgeTypes: ["JAVA_CALL"], symbols: ["demo.App#run()"] },
          { path: "src/main/webapp/index.jsp", nodeType: "jsp", edgeTypes: ["JSP_SCRIPTLET_CALL"], symbols: ["work"] }
        ]
      },
      {
        path: "src/main/webapp/index.jsp",
        nodeType: "jsp",
        referenceCount: 1,
        dependantCount: 0,
        references: [{ path: "src/main/java/demo/Service.java", nodeType: "java", edgeTypes: ["JSP_SCRIPTLET_CALL"], symbols: ["work"] }],
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
    calls: [{ from: "demo.App#run()", to: "demo.Service#work()", fromFile: "src/main/java/demo/App.java", toFile: "src/main/java/demo/Service.java" }],
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
    methodCalls: [{ file: "src/main/webapp/index.jsp", methodName: "work", classPath: "demo.Service" }]
  });

  return analysisOut;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}
