import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { LeflectConfig } from "@leflect-java/schema";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSourceResolution, type ResolveReferencesResult } from "../index";
import { resolveJavaWorkerJar } from "../worker-jar";

const serviceRoot = "class_src_service/src";
const wbfRoot = "class_src_wbf/src";
const payClass = "app.com.pay.service.PayService";
const payFile = "app/com/pay/service/PayService.java";
const helperFile = "app/wbf/Helper.java";
const pagePath = "/mobweb/comm/x.jsp";

function reference(result: ResolveReferencesResult, expression: string, targetId = "page") {
  return result.references.find((item) => item.expression === expression && item.targetId === targetId);
}

describe("registered workspace source resolution", () => {
  let workerJar: string | undefined;
  let root: string;
  beforeAll(async () => { workerJar = await resolveJavaWorkerJar(); });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect 조회 workspace "));
    await fs.mkdir(path.join(root, serviceRoot), { recursive: true });
    await fs.mkdir(path.join(root, wbfRoot), { recursive: true });
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  function createResolver(sourceResolution: LeflectConfig["sourceResolution"] = {}) {
    return createSourceResolution({
      root, analysisOut: path.join(root, "analysis"), java: { workerJar },
      sourceResolution: { webRoot: ".", javaRoots: [`./${serviceRoot}/`, `./${wbfRoot}`], ...sourceResolution }
    });
  }

  async function write(relative: string, content: string): Promise<void> {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  }

  it("A1 finds explicit JSP imports across roots and reports unavailable roots", async ({ skip }) => {
    if (!workerJar) return skip();
    const pay = "package app.com.pay.service; public class PayService {}\r\n";
    await write(`${serviceRoot}/${payFile}`, pay);
    await write(`${wbfRoot}/${helperFile}`, "package app.wbf; public class Helper {}");
    await write(pagePath.slice(1), `<%@ page import="${payClass}, app.wbf.Helper" %>\r\n<% new PayService(); new Helper(); %>`);
    const query = { targets: [{ targetId: "page", kind: "jsp" as const, path: pagePath }] };

    const result = await createResolver().resolveReferences(query);
    expect(result.status).toBe("complete");
    expect(result.targets).toMatchObject([{ targetId: "page", status: "resolved" }]);
    expect(reference(result, "PayService")).toMatchObject({
      status: "resolved",
      location: { rootId: "web", path: pagePath.slice(1), line: 2, column: 8 },
      importLocation: { rootId: "web", line: 1, column: 18 },
      candidates: [{ rootId: "java-1", path: payFile, sourceHash: createHash("sha256").update(pay).digest("hex") }]
    });
    expect(reference(result, "Helper")).toMatchObject({
      status: "resolved", candidates: [{ rootId: "java-2", path: helperFile }]
    });

    const incomplete = await createResolver({ javaRoots: [serviceRoot, "missing", wbfRoot] }).resolveReferences(query);
    expect(incomplete.status).toBe("partial");
    expect(incomplete.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_ROOT_UNAVAILABLE", rootId: "java-2" })
    ]));
    expect(reference(incomplete, "PayService")).toMatchObject({
      status: "blocked", candidates: [{ rootId: "java-1", path: payFile }]
    });
    expect(reference(incomplete, "Helper")).toMatchObject({
      status: "blocked", candidates: [{ rootId: "java-3", path: helperFile }]
    });
  }, 15000);

  it("A2 follows only used types across package wildcards and recursive Java sources", async ({ skip }) => {
    if (!workerJar) return skip();
    await write(`${serviceRoot}/${payFile}`, "package app.com.pay.service; import app.wbf.*; public class PayService { Helper helper; }");
    await write(`${wbfRoot}/${helperFile}`, "package app.wbf; public class Helper {}");
    await write(`${wbfRoot}/app/wbf/Unused.java`, "package app.wbf; public class Unused {}");
    await write(`${serviceRoot}/app/RootType.java`, "package app; public class RootType {}");
    await write(pagePath.slice(1), [
      '<%@ page import="app.com.pay.service.*" %>',
      '<script>const ignored = "new JavaScriptOnly()";</script>',
      '<%-- <% new CommentOnly(); %> --%>',
      '<% new PayService(); String s = "new StringOnly()"; // new JavaCommentOnly()',
      '%>'
    ].join("\n"));
    const rootPage = "/mobweb/comm/root.jsp";
    await write(rootPage.slice(1), '<%@ page import="app.*" %>\n<% new RootType(); new PayService(); %>');

    const result = await createResolver().resolveReferences({
      targets: [{ targetId: "page", kind: "jsp", path: pagePath }, { targetId: "root", kind: "jsp", path: rootPage }],
      scope: { followReferences: true, maxDepth: 4 }
    });
    expect(reference(result, "PayService")).toMatchObject({
      status: "resolved", importLocation: { line: 1 }, candidates: [{ className: payClass }]
    });
    expect(reference(result, "Helper")).toMatchObject({
      status: "resolved", location: { rootId: "java-1", path: payFile }, candidates: [{ path: helperFile }]
    });
    expect(reference(result, "RootType", "root")).toMatchObject({ status: "resolved", candidates: [{ className: "app.RootType" }] });
    expect(reference(result, "PayService", "root")).toMatchObject({ status: "missing", candidates: [] });
    expect(result.references.map(({ expression }) => expression).join(" ")).not.toMatch(/Unused|CommentOnly|StringOnly|JavaScriptOnly/);
  }, 15000);

  it("A3 honors explicit imports and preserves both kinds of ambiguity", async ({ skip }) => {
    if (!workerJar) return skip();
    await write(`${serviceRoot}/${payFile}`, "package app.com.pay.service; public class PayService {}");
    await write(`${wbfRoot}/alt/PayService.java`, "package alt; public class PayService {}");
    const wildcardPage = "/mobweb/comm/wildcard.jsp";
    const missingPage = "/mobweb/comm/missing.jsp";
    await write(pagePath.slice(1), `<%@ page import="${payClass}, alt.*" %><% new PayService(); %>`);
    await write(wildcardPage.slice(1), '<%@ page import="app.com.pay.service.*, alt.*" %><% new PayService(); %>');
    await write(missingPage.slice(1), '<%@ page import="absent.PayService, alt.*" %><% new PayService(); %>');
    const result = await createResolver().resolveReferences({ targets: [
      { targetId: "page", kind: "jsp", path: pagePath },
      { targetId: "wildcard", kind: "jsp", path: wildcardPage },
      { targetId: "missing", kind: "jsp", path: missingPage }
    ] });
    expect(reference(result, "PayService")).toMatchObject({ status: "resolved", candidates: [{ className: payClass }] });
    expect(reference(result, "PayService", "wildcard")).toMatchObject({
      status: "ambiguous", location: { line: 1 },
      candidates: [{ className: payClass }, { className: "alt.PayService" }]
    });
    expect(reference(result, "PayService", "missing")).toMatchObject({ status: "missing", candidates: [] });

    await write(`${wbfRoot}/${payFile}`, "package app.com.pay.service; public class PayService { private int version; }");
    const query = { targets: [{ targetId: "java", kind: "java" as const, className: payClass }] };
    const ambiguous = await createResolver().resolveReferences(query);
    expect(ambiguous.targets).toMatchObject([{
      status: "ambiguous", candidates: [{ rootId: "java-1", path: payFile }, { rootId: "java-2", path: payFile }]
    }]);
    const mapped = await createResolver({ javaMap: { [payClass]: path.join(root, wbfRoot, payFile) } }).resolveReferences(query);
    expect(mapped.targets).toMatchObject([{ status: "resolved", candidates: [{ rootId: "java-2", path: payFile }] }]);
  }, 15000);

  it("A4 preserves static fragment and request page path and import contexts", async ({ skip }) => {
    if (!workerJar) return skip();
    const otherPage = "/mobweb/comm/other.jsp";
    const fragment = "mobweb/comm/bits/nested/child.jspf";
    await write(`${serviceRoot}/a/Widget.java`, "package a; public class Widget {}");
    await write(`${wbfRoot}/b/Widget.java`, "package b; public class Widget {}");
    await write(pagePath.slice(1), '<%@ page import="a.*" %>\n<%@ include file="bits/first.jspf" %>');
    await write(otherPage.slice(1), '<%@ page import="b.*" %>\n<%@ include file="bits/first.jspf" %>');
    await write("mobweb/comm/bits/first.jspf", '<%@ include file="nested/child.jspf" %>');
    await write(fragment, [
      '<% new Widget(); %>',
      '<jsp:include page="runtime.jsp" />',
      '<jsp:include page="${param.page}" />',
      '<%@ include file="../first.jspf" %>'
    ].join("\n"));
    await write("mobweb/comm/runtime.jsp", '<%@ page import="b.*" %><% new Widget(); %>');
    const query = {
      targets: [{ targetId: "page", kind: "jsp" as const, path: pagePath }, { targetId: "other", kind: "jsp" as const, path: otherPage }],
      scope: { followReferences: true, maxDepth: 4 }
    };
    const result = await createResolver().resolveReferences(query);
    expect(result.targets).toMatchObject([{ status: "resolved" }, { status: "resolved" }]);
    const fragments = result.references.filter(({ expression, location }) => expression === "Widget" && location.path === fragment);
    expect(fragments).toMatchObject([
      { targetId: "page", status: "resolved", context: { entryPath: pagePath, includeChain: [{ path: pagePath.slice(1) }, { path: "mobweb/comm/bits/first.jspf" }] }, candidates: [{ className: "a.Widget" }] },
      { targetId: "other", status: "resolved", context: { entryPath: otherPage }, candidates: [{ className: "b.Widget" }] }
    ]);
    expect(reference(result, "runtime.jsp")).toMatchObject({
      status: "resolved", includeKind: "request", candidates: [{ logicalPath: "/mobweb/comm/runtime.jsp" }]
    });
    expect(result.references.find(({ expression, location }) => expression === "Widget" && location.path === "mobweb/comm/runtime.jsp"))
      .toMatchObject({ status: "resolved", context: { entryPath: "/mobweb/comm/runtime.jsp" }, candidates: [{ className: "b.Widget" }] });
    expect(reference(result, "${param.page}")).toMatchObject({ status: "dynamic", includeKind: "request" });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "JSP_INCLUDE_CYCLE", location: expect.objectContaining({ path: fragment, line: 4 }) })
    ]));

    const doubled = await createResolver({ webRoot: "mobweb" }).resolveReferences({ targets: query.targets.slice(0, 1) });
    expect(doubled.targets).toMatchObject([{ status: "missing" }]);
    expect(doubled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_NOT_FOUND", rootId: "web", path: pagePath.slice(1) })
    ]));
  }, 15000);

  it("looks up a written FQN used as a qualifier while preserving value shadowing", async ({ skip }) => {
    if (!workerJar) return skip();
    await write(`${serviceRoot}/app/Caller.java`, [
      "package app; public class Caller {",
      "  static class Root { Object Tool; }",
      "  void work(Root project) { project.Tool.toString(); acme.support.Tool.run(); }",
      "}"
    ].join("\n"));
    await write(`${wbfRoot}/acme/support/Tool.java`, "package acme.support; public class Tool { public static void run() {} }");
    await write(`${wbfRoot}/project/Tool.java`, "package project; public class Tool {}");
    const result = await createResolver().resolveReferences({ targets: [{ targetId: "java", kind: "java", className: "app.Caller" }] });
    expect(reference(result, "acme.support.Tool", "java")).toMatchObject({
      status: "resolved", binding: "candidate", candidates: [{ className: "acme.support.Tool", path: "acme/support/Tool.java" }]
    });
    expect(reference(result, "project.Tool", "java")).toBeUndefined();
    expect(result.sources.some(({ path: candidate }) => candidate === "project/Tool.java")).toBe(false);
  }, 15000);
});
