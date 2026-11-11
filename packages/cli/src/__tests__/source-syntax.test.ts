import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildJspJava, createSourceSyntaxReader, parseJspSyntax } from "../source-syntax";
import { resolveJavaWorkerJar } from "../worker-jar";

describe("JSP source syntax", () => {
  it("distinguishes scriptlets, includes, imports, and template text", () => {
    const page = [
      '<%@ page import="app.service.*, app.Helper" %>',
      '<%@ include file="fragment.jspf" %>',
      '<jsp:include page="${param.target}" />',
      '<%-- <% new Fake(); %> --%>',
      '<script>const example = "new JavaScriptOnly()";</script>',
      '<% new PayService(); %>'
    ].join("\r\n");
    const syntax = parseJspSyntax(page, "/page.jsp");
    expect(syntax.imports.map(({ name, wildcard, location }) => [name, wildcard, location.line, location.column])).toEqual([
      ["app.service", true, 1, 18], ["app.Helper", false, 1, 33]
    ]);
    expect(syntax.includes.map(({ expression, kind, dynamic }) => [expression, kind, dynamic])).toEqual([
      ["fragment.jspf", "translation", false], ["${param.target}", "request", true]
    ]);
    expect(syntax.scriptlets.map(({ code }) => code)).toEqual(["new PayService();"]);
  });

  it("keeps JSPX include and scriptlet origins through XML decoding", () => {
    const page = [
      '<j:root xmlns:j="http://java.sun.com/JSP/Page" version="2.3">',
      '  <j:directive.page import="app.Foo"/>',
      '  <j:directive.include file="fragment.jspx"/>',
      '  <!-- <j:include page="ignored.jspx"/> -->',
      '  <j:scriptlet>if (1 &lt; 2) { <![CDATA[new Foo();]]> }</j:scriptlet>',
      '</j:root>'
    ].join("\n");
    const syntax = parseJspSyntax(page, "/page.jspx");
    expect(syntax.diagnostics).toEqual([]);
    expect(syntax.imports.map(({ name }) => name)).toEqual(["app.Foo"]);
    expect(syntax.includes.map(({ expression, kind }) => [expression, kind])).toEqual([["fragment.jspx", "translation"]]);
    expect(syntax.scriptlets.map(({ code }) => code)).toEqual(["if (1 < 2) { new Foo(); }"]);
    const { text, mapLocation } = buildJspJava(syntax.scriptlets.map((scriptlet) => ({ scriptlet, text: page })), syntax.imports);
    const generated = text.split("\n").findIndex((line) => line.includes("new Foo")) + 1;
    const column = text.split("\n")[generated - 1].indexOf("Foo") + 1;
    const original = page.split("\n")[4].indexOf("Foo") + 1;
    expect(mapLocation({ line: generated, column, endLine: generated, endColumn: column + 2 })).toEqual({
      partIndex: 0, location: { line: 5, column: original, endLine: 5, endColumn: original + 2 }
    });
  });

  it.each([
    ["/page.jsp", String.raw`<%@ page info="quoted \" text import='wrong.Fake'"`, '%>'],
    ["/page.jspx", `<jsp:root xmlns:jsp="http://java.sun.com/JSP/Page">\n<jsp:directive.page info='text import="wrong.Fake"'`, '/></jsp:root>']
  ])("extracts imports from actual attributes in %s", (logicalPath, opening, closing) => {
    expect(parseJspSyntax(`${opening} ${closing}`, logicalPath).imports).toEqual([]);
    const { imports } = parseJspSyntax(`${opening}\r\n  import = 'right.Real, right.extra.*' ${closing}`, logicalPath);
    const line = logicalPath.endsWith(".jspx") ? 3 : 2;
    expect(imports).toEqual([
      { name: "right.Real", wildcard: false, static: false, location: { line, column: 13, endLine: line, endColumn: 22 } },
      { name: "right.extra", wildcard: true, static: false, location: { line, column: 25, endLine: line, endColumn: 37 } }
    ]);
  });

  it("reports custom tag and EL call context at the original positions", () => {
    const syntax = parseJspSyntax('<c:if test="${not empty fn:trim(value)}">content</c:if>', "/view.jsp");
    expect(syntax.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_JSP_TAG_CONTEXT", location: expect.objectContaining({ line: 1, column: 1 }) }),
      expect.objectContaining({ code: "SOURCE_JSP_EL_CONTEXT", location: expect.objectContaining({ line: 1, column: 13 }) })
    ]));
  });
});

describe("Java worker source syntax", () => {
  let reader: ReturnType<typeof createSourceSyntaxReader> | undefined;
  beforeAll(async () => {
    const workerJar = await resolveJavaWorkerJar();
    if (workerJar) reader = createSourceSyntaxReader({ java: { workerJar } });
  });
  afterAll(() => reader?.close());

  it("finds declarations and syntactic uses with lexical shadowing", async ({ skip }) => {
    if (!reader) return skip();
    const syntax = await reader.java([
      "package app; import pay.*; import static pay.PayService.*;",
      "@Deprecated public class Outer<R> {",
      "  public static class Nested {}",
      "  void work() {",
      '    String note = "😀 new Ignored()"; // new AlsoIgnored()',
      "    R generic; new PayService();",
      "    class PayService {}",
      "\tPayService local; Nested nested;",
      "  }",
      "}"
    ].join("\r\n"));
    expect(syntax.diagnostics).toEqual([]);
    expect(syntax.imports.map(({ name, wildcard, static: isStatic }) => [name, wildcard, isStatic])).toEqual([
      ["pay", true, false], ["pay.PayService", true, true]
    ]);
    expect(syntax.declarations.map(({ className }) => className)).toEqual(["app.Outer", "app.Outer.Nested"]);
    expect(syntax.types.map(({ expression, shadowed }) => [expression, shadowed])).toEqual([
      ["Deprecated", false], ["String", false], ["R", true], ["PayService", false],
      ["PayService", true], ["Nested", true]
    ]);
    expect(syntax.types.find(({ expression, shadowed }) => expression === "PayService" && shadowed)?.location).toEqual({
      line: 8, column: 2, endLine: 8, endColumn: 11
    });
    expect(await reader.isPlatformType("java.util.Map.Entry")).toBe(true);
    expect(await reader.isPlatformType("java.lang.Missing")).toBe(false);
  });

  it("maps JSP translation uses to their individual scriptlet parts", async ({ skip }) => {
    if (!reader) return skip();
    const page = '<%@ page import="pay.*" %>\r\n<% if (true) { %>\r\n<%= new PayService() %>\r\n<% } %>';
    const { imports, scriptlets } = parseJspSyntax(page, "/한글 경로.jsp");
    const syntax = await reader.jsp(scriptlets.map((scriptlet) => ({ scriptlet, text: page })), imports);
    expect(syntax.diagnostics).toEqual([]);
    expect(syntax.types).toEqual([expect.objectContaining({
      expression: "PayService", partIndex: 1, location: { line: 3, column: 9, endLine: 3, endColumn: 18 }
    })]);
  });

  it("keeps unresolved dotted qualifiers without promoting local receiver expressions", async ({ skip }) => {
    if (!reader) return skip();
    const syntax = await reader.java(`class Example {
      static class Root { Object Tool; }
      void work(Root com) {
        com.Tool.toString();
        acme.support.Tool.run();
      }
    }`);
    const qualifiers = syntax.types.filter(({ role }) => role === "qualifier");
    expect(qualifiers).toContainEqual(expect.objectContaining({ expression: "acme.support.Tool", resolvedName: undefined }));
    expect(qualifiers.some(({ expression }) => expression === "com.Tool")).toBe(false);
  });

  it("reports named inheritance scopes, private enclosing types, and platform visibility", async ({ skip }) => {
    if (!reader) return skip();
    const syntax = await reader.java(`package app; import base.Root;
      public class Outer extends Root {
        static class Root {}
        public class Member extends base.Generic<args.Header> implements base.Marker {
          inherited.Token member;
          Object anonymous = new external.Parent() { Token hidden; };
          void work() { class Local extends external.Base { Token local; } }
        }
        private class Hidden { protected class Deep {} }
      }`);
    expect(syntax.diagnostics).toEqual([]);
    expect(syntax.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: "app.Outer", superTypes: ["Root"] }),
      expect.objectContaining({ className: "app.Outer.Member", superTypes: ["base.Generic", "base.Marker"] }),
      expect.objectContaining({ className: "app.Outer.Hidden.Deep", access: "private" })
    ]));
    expect(syntax.types.find(({ expression }) => expression === "Root")).toMatchObject({ enclosingTypes: [], shadowed: false });
    expect(syntax.types.find(({ expression }) => expression === "args.Header")?.enclosingTypes).toEqual(["app.Outer"]);
    expect(syntax.types.find(({ expression }) => expression === "inherited.Token")?.enclosingTypes).toEqual(["app.Outer.Member", "app.Outer"]);
    expect(syntax.types.filter(({ expression }) => expression === "Token").map(({ inheritanceUncertain }) => inheritanceUncertain)).toEqual([true, true]);
    expect(await reader.platformTypeAccess("java.util.Map.Entry")).toBe("public");
    expect(await reader.platformTypeAccess("java.lang.AbstractStringBuilder")).toBe("nonpublic");
    expect(await reader.platformTypeAccess("java.lang.Missing")).toBe("missing");
  });

  it("distinguishes known platform member absence from unavailable metadata", async ({ skip }) => {
    if (!reader) return skip();
    expect(await reader.platformMemberTypes("java.io.Serializable", "WorkspaceType")).toEqual([]);
    expect(await reader.platformMemberTypes("java.lang.Exception", "WorkspaceType")).toEqual([]);
    expect(await reader.platformMemberTypes("java.util.HashMap", "Entry")).toEqual(["java.util.Map.Entry"]);
    expect(await reader.platformMemberTypes("javax.swing.JFrame", "AccessibleAWTFrame")).toEqual(["java.awt.Frame.AccessibleAWTFrame"]);
    expect(await reader.platformMemberTypes("workspace.Unavailable", "Entry")).toBeUndefined();
  });
});
