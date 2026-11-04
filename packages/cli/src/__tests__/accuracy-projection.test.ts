import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGraphs, writeGraphFiles } from "@leflect-java/graph";
import { buildLabelsIndex } from "@leflect-java/labeler";
import { discoverServletEntries } from "../servlet-entries";
import { buildProjectionGraph, entryNodeId, loadProjectionSnapshot, queryProjectionEntries } from "../projection";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("HTTP entry projection", () => {
  it("retains descriptor locations and handlers through graph persistence and route projection", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-http-projection-"));
    scratch.push(root);
    const analysisOut = path.join(root, "out");
    const descriptor = [
      '<web-app>',
      '  <servlet><servlet-name>bank</servlet-name><servlet-class>demo.Bank</servlet-class></servlet>',
      '  <servlet-mapping><servlet-name>bank</servlet-name><url-pattern>/page</url-pattern></servlet-mapping>',
      '  <servlet><servlet-name>health</servlet-name><servlet-class>demo.Health</servlet-class></servlet>',
      '  <servlet-mapping><servlet-name>health</servlet-name><url-pattern>/health</url-pattern></servlet-mapping>',
      '</web-app>'
    ].join("\n");
    await fs.mkdir(path.join(root, "web/WEB-INF"), { recursive: true });
    await fs.writeFile(path.join(root, "web/WEB-INF/web.xml"), descriptor);
    const classes = [
      { id: "demo.Bank", name: "Bank", file: "src/Bank.java" },
      { id: "demo.Health", name: "Health", file: "src/Health.java" },
      { id: "demo.TaskTag", name: "TaskTag", file: "src/TaskTag.java", extendsTypes: ["SimpleTagSupport"] }
    ];
    const methods = [
      { id: "demo.Bank#service()", name: "service", classId: "demo.Bank" },
      { id: "demo.Bank#doGet()", name: "doGet", classId: "demo.Bank" },
      { id: "demo.Health#doGet()", name: "doGet", classId: "demo.Health" }
    ];
    const discovered = await discoverServletEntries({ root, analysisOut, jsp: { webappRoot: path.join(root, "web") } }, classes, methods);
    const graphs = buildGraphs([], [
      { path: "web/page.jsp", sourceKind: "jsp", scriptlets: [] },
      { path: "web/fragment.tag", sourceKind: "tag", scriptlets: [] }
    ], classes, { entries: discovered.entries });
    await writeGraphFiles(analysisOut, graphs);
    await fs.mkdir(path.join(analysisOut, "index"), { recursive: true });
    await fs.writeFile(path.join(analysisOut, "index/jsp-files.json"), JSON.stringify([
      { path: "web/page.jsp", sourceKind: "jsp" },
      { path: "web/fragment.tag", sourceKind: "tag" }
    ]));
    const snapshot = await loadProjectionSnapshot(analysisOut, "http-test", root);
    expect(snapshot.filesByPath.get("web/page.jsp")?.sourceKind).toBe("jsp");
    expect(snapshot.filesByPath.get("web/fragment.tag")?.sourceKind).toBe("tag");
    const entries = queryProjectionEntries(snapshot, { offset: 0, limit: 10 });
    expect(entries.total).toBe(2);
    for (const [servletName, urlPattern, line, declarationLine, handler, file] of [
      ["bank", "/page", 3, 2, "demo.Bank#service()", "src/Bank.java"],
      ["health", "/health", 5, 4, "demo.Health#doGet()", "src/Health.java"]
    ] as const) {
      const entry = entries.entries.find((candidate) => candidate.http?.servletName === servletName)!;
      expect(entry).toMatchObject({
        source: "declared", label: urlPattern, disabled: false, seedPaths: [file],
        http: { sourcePath: "web/WEB-INF/web.xml", urlPattern,
          lineRange: { startLine: line }, declarationRange: { startLine: declarationLine }, handlerMethodIds: [handler] }
      });
      const rootId = entryNodeId(entry.id);
      const graph = buildProjectionGraph(snapshot, { entryId: entry.id, maxNodes: 10 });
      expect(graph.nodes).toHaveLength(3);
      expect(graph.nodes.find((node) => node.id === `${rootId}:route`)).toMatchObject({
        parentId: rootId, label: urlPattern, depth: 1, symbols: [handler]
      });
      expect(graph.nodes.find((node) => node.path === file)).toMatchObject({ parentId: `${rootId}:route`, depth: 2 });
      expect(graph.edges.find((edge) => edge.type === "HTTP_ROUTE")).toMatchObject({
        sourceId: rootId, targetId: `${rootId}:route`, symbols: [handler]
      });
      expect(graph.edges.find((edge) => edge.type === "ENTRY_SEED")).toMatchObject({ sourceId: `${rootId}:route`, targetId: file });
      expect(buildProjectionGraph(snapshot, { entryId: entry.id, depth: 1, maxNodes: 10 }).nodes).toHaveLength(2);
      const limited = buildProjectionGraph(snapshot, { entryId: entry.id, maxNodes: 1 });
      expect(limited.nodes).toHaveLength(1);
      expect(limited.truncated).toBe(true);
    }
    const registered = new Set(discovered.registrations.map((row) => row.className));
    const labels = buildLabelsIndex({
      classes: classes.map((entry) => ({ ...entry, registeredServlet: registered.has(entry.id) })), methods, jsps: []
    });
    expect(labels.classes["demo.Bank"]).toEqual(["CONTROLLER"]);
    expect(labels.classes["demo.Health"]).toEqual(["CONTROLLER"]);
    expect(labels.classes["demo.TaskTag"]).toEqual(["TAG_HANDLER"]);
  });
});
