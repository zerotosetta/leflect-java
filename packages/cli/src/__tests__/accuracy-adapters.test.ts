import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWebXml } from "@leflect-java/parser-tld";
import { buildJspSemanticAsts } from "@leflect-java/indexer";
import { parseJsp } from "@leflect-java/parser-jsp";
import { discoverServletEntries } from "../servlet-entries";
import { buildTaskCodeIndex, readTaskCodes, writeTaskCodes } from "../task-codes";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-accuracy-"));
  scratch.push(root);
  await fs.mkdir(path.join(root, "web", "WEB-INF"), { recursive: true });
  return root;
}

describe("accuracy adapters", () => {
  it("discovers namespaced HTTP mappings and preserves explicit overrides and source positions", async () => {
    const source = [
      '<j:web-app xmlns:j="urn:test">',
      '<!-- <j:servlet-mapping><j:servlet-name>fake</j:servlet-name><j:url-pattern>/fake</j:url-pattern></j:servlet-mapping> -->',
      '<j:servlet><j:servlet-name>bank</j:servlet-name><j:servlet-class>demo.Bank</j:servlet-class></j:servlet>',
      '<j:servlet-mapping><j:servlet-name>bank</j:servlet-name><j:url-pattern>/page</j:url-pattern><j:url-pattern>/extra/*</j:url-pattern></j:servlet-mapping>',
      '<j:servlet-mapping><j:servlet-name>missing</j:servlet-name><j:url-pattern>*.action</j:url-pattern></j:servlet-mapping>',
      '</j:web-app>'
    ].join("\n");
    expect(parseWebXml(source)).toMatchObject([
      { servletName: "bank", className: "demo.Bank", urlPattern: "/page", lineRange: { startLine: 4 } },
      { servletName: "bank", urlPattern: "/extra/*" },
      { servletName: "missing", className: undefined, urlPattern: "*.action" }
    ]);
    const root = await workspace();
    await fs.writeFile(path.join(root, "web/WEB-INF/web.xml"), source);
    const manual = { id: "http:bank:%2Fpage", type: "entry" as const, label: "Manual", java: ["Bank.java"] };
    const result = await discoverServletEntries({
      root, analysisOut: path.join(root, "out"), jsp: { webappRoot: path.join(root, "web") }, entries: [manual]
    }, [{ id: "demo.Bank", file: "Bank.java" }], [{ id: "demo.Bank#doGet()", classId: "demo.Bank", name: "doGet" }]);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual(manual);
    expect(result.registrations[0].handlerMethodIds).toEqual(["demo.Bank#doGet()"]);
    expect(result.registrations[2].handlerMethodIds).toEqual([]);
    expect(result.registrations[2].diagnostic).toContain("No servlet class");
  });

  it("collects URI-bound task codes through semantic nodes and replaces removed occurrences", async () => {
    const root = await workspace();
    const source = [
      '<%@ taglib prefix="alias" uri="urn:demo:wfw" %>',
      '<%-- <alias:task code="COMMENT"/> --%>',
      '<alias:task code="A"/>',
      '<alias:task code="A"/>',
      '<alias:task code="${param.code}"/>',
      '<alias:task/>',
      '<alias:task code=""/>',
      '<%@ taglib prefix="wrong" uri="urn:other" %>',
      '<wrong:task code="IGNORE"/>',
      '<div data="<alias:task code=\'B\'/>"></div>'
    ].join("\n");
    const doc = { path: "web/page.jsp", ...parseJsp(source), resolvedTags: [
      { prefix: "alias", name: "task", uri: "urn:demo:wfw", handlerClass: "demo.TaskTag" },
      { prefix: "wrong", name: "task", uri: "urn:other", handlerClass: "other.TaskTag" }
    ] };
    const asts = await buildJspSemanticAsts({
      projectRoot: root, analysisOut: path.join(root, "out"), astMode: "lightweight", docs: [doc],
      files: [], registry: []
    });
    const index = buildTaskCodeIndex(asts);
    expect(index.counts).toEqual({ occurrences: 6, literalOccurrences: 3, distinctCodes: 2, dynamicOccurrences: 1, invalidOccurrences: 2 });
    expect(index.codes).toEqual(["A", "B"]);
    expect(index.occurrences.map((row) => row.lineRange.startLine)).toEqual([3, 4, 5, 6, 7, 10]);
    await writeTaskCodes(path.join(root, "out"), index);
    expect((await readTaskCodes(path.join(root, "out"), "web/page.jsp")).occurrences).toHaveLength(6);
    await writeTaskCodes(path.join(root, "out"), buildTaskCodeIndex([]));
    expect((await readTaskCodes(path.join(root, "out"))).occurrences).toEqual([]);
  });
});
