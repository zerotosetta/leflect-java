import fs from "fs/promises";
import os from "os";
import path from "path";

import { parseJsp } from "@leflect-java/parser-jsp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveJspIncludes } from "../jsp-includes";
import { describeJspBeans } from "../jsp-beans";

describe("JSP include references", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-jsp-includes-"));
    await fs.mkdir(path.join(root, "web", "fragments"), { recursive: true });
    for (const name of ["panel.jsp", "help.jsp"]) {
      await fs.writeFile(path.join(root, "web", "fragments", name), "");
    }
    await fs.writeFile(path.join(root, "outside.jsp"), "");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function resolveIncludes(source: string, includeTargets?: Record<string, string>) {
    const page = "web/layout.jsp";
    const parsed = parseJsp(source);
    return resolveJspIncludes({
      root,
      analysisOut: path.join(root, "analysis"),
      jsp: { webappRoot: "web", includeTargets }
    }, [{ path: page, ...parsed }], []).then((result) => result.get(page));
  }

  it("preserves repeated uses of the same target and associates params with each include", async () => {
    const includes = await resolveIncludes([
      '<jsp:include page="/fragments/panel.jsp">',
      '  <jsp:param name="slot" value="header"/>',
      '</jsp:include>',
      '<jsp:include page="fragments/panel.jsp?show=1">',
      "  <jsp:param name='slot' value='footer'/>",
      '</jsp:include>',
      '<jsp:include page="../outside.jsp"/>'
    ].join("\n"));

    expect(includes).toMatchObject([
      {
        kind: "static", targetPath: "web/fragments/panel.jsp", location: { line: 1 },
        parameters: [{ name: "slot", value: "header", location: { line: 2 } }]
      },
      {
        kind: "static", targetPath: "web/fragments/panel.jsp", location: { line: 4 },
        parameters: [{ name: "slot", value: "footer", location: { line: 5 } }]
      },
      { kind: "static", unresolvedReason: expect.any(String), parameters: [] }
    ]);
    expect(includes?.[2].targetPath).toBeUndefined();
  });

  it("keeps the loop origin and resolves dynamic paths only with verified evidence", async () => {
    const source = [
      '<%@ taglib prefix="loop" uri="http://java.sun.com/jsp/jstl/core" %>',
      '<loop:forEach items="${model.areas[param.slot]}" var="component">',
      '  <jsp:include page="${component}"/>',
      '</loop:forEach>'
    ].join("\n");
    const [dynamic] = (await resolveIncludes(source))!;
    expect(dynamic.kind).toBe("dynamic");
    expect(dynamic.targetPath).toBeUndefined();
    expect(dynamic.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "component iterates over ${model.areas[param.slot]}" }),
      expect.objectContaining({ description: "Request parameter: slot" })
    ]));
    const [configured] = (await resolveIncludes(source, { "${component}": "/fragments/help.jsp" }))!;
    expect(configured.targetPath).toBe("web/fragments/help.jsp");
    expect(configured.kind).toBe("dynamic");
    const [missing] = (await resolveIncludes(source, { "${component}": "/fragments/missing.jsp" }))!;
    expect(missing.targetPath).toBeUndefined();
    expect(missing.unresolvedReason).toContain("does not resolve");
  });

  it("preserves both verified literal branches of an EL include", async () => {
    const [include] = (await resolveIncludes(
      '<jsp:include page="${mode ? \'/fragments/help.jsp\' : \'/fragments/panel.jsp\'}"/>'
    ))!;
    expect(include.candidatePaths).toEqual(["web/fragments/help.jsp", "web/fragments/panel.jsp"]);
    expect(include.targetPath).toBeUndefined();
  });

  it("only links an actually selected constant branch and ignores non-path operators", async () => {
    const [selected, boolean] = (await resolveIncludes([
      '<jsp:include page="${true ? \'/fragments/help.jsp\' : \'/fragments/missing.jsp\'}"/>',
      '<jsp:include page="${not \'/fragments/help.jsp\'}"/>'
    ].join("\n")))!;
    expect(selected.targetPath).toBe("web/fragments/help.jsp");
    expect(selected.candidatePaths).toBeUndefined();
    expect(boolean.targetPath).toBeUndefined();
    expect(boolean.candidatePaths).toBeUndefined();
  });

  it("collects standard actions inside attributes with parameter ownership and bean metadata", async () => {
    const page = "web/layout.jsp";
    const parsed = parseJsp([
      '<a',
      ' title="<jsp:include page=\'/fragments/panel.jsp\'><jsp:param name=\'slot\' value=\'header\'/></jsp:include>"',
      ' data-clock="<jsp:useBean id=\'clock\' class=\'java.util.Date\'/>">after</a>'
    ].join("\n"));
    const docs = [{ path: page, ...parsed }];
    const [includes, beans] = await Promise.all([
      resolveJspIncludes({ root, analysisOut: path.join(root, "analysis"), jsp: { webappRoot: "web" } }, docs, []),
      describeJspBeans(docs, { root })
    ]);
    expect(parsed.document.diagnostics).toEqual([]);
    expect(includes.get(page)).toMatchObject([{
      kind: "static", targetPath: "web/fragments/panel.jsp", location: { line: 2, column: 9 },
      parameters: [{ name: "slot", value: "header", location: { line: 2 } }]
    }]);
    expect(beans.get(page)).toMatchObject([{
      id: "clock", className: "java.util.Date", scope: "page", lineRange: { startLine: 3 },
      actionDescription: expect.any(String)
    }]);
  });
});
