import { describe, expect, it } from "vitest";

import { attachJspAstReference, parseEl, parseJsp } from "../parse";
import { resolveTagHandlers } from "../resolve";
import { TldIndex } from "@leflect-java/parser-tld";

describe("parseJsp", () => {
  it("extracts taglibs, tags, and scriptlets", () => {
    const jsp = `<%@ page import="java.util.List, com.example.CustomerService" %>\n` +
      `<%@ taglib prefix="c" uri="http://example.com/tags" %>\n` +
      `<c:hello />\n` +
      `<% int x = 1; %>`;

    const result = parseJsp(jsp);

    expect(result.directives).toHaveLength(2);
    expect(result.imports).toEqual(["com.example.CustomerService", "java.util.List"]);
    expect(result.taglibs).toMatchObject([
      { prefix: "c", uri: "http://example.com/tags" }
    ]);
    expect(result.tags[0].prefix).toBe("c");
    expect(result.tags[0].name).toBe("hello");
    expect(result.tags[0].location).toEqual({
      line: 3,
      column: 1,
      endLine: 3,
      endColumn: 9
    });
    expect(result.scriptlets).toHaveLength(1);
    expect(result.scriptlets[0].kind).toBe("scriptlet");
    expect(result.scriptlets[0].code).toBe("int x = 1;");
    expect(result.scriptlets[0].location).toEqual({
      line: 4,
      column: 4,
      endLine: 4,
      endColumn: 13
    });
  });

  it("resolves tag handlers", () => {
    const jsp = `<%@ taglib prefix="c" uri="http://example.com/tags" %>\n<c:hello />`;
    const parsed = parseJsp(jsp);

    const tld: TldIndex = {
      uri: "http://example.com/tags",
      tags: [{ name: "hello", handlerClass: "com.example.HelloTag" }]
    };

    const resolved = resolveTagHandlers(parsed.tags, parsed.taglibs, [tld]);

    expect(resolved[0]).toEqual({
      prefix: "c",
      name: "hello",
      uri: "http://example.com/tags",
      handlerClass: "com.example.HelloTag"
    });
  });

  it("attaches jasper ast metadata", () => {
    const parsed = parseJsp("<%= 1 %>");
    const withAst = attachJspAstReference(parsed, {
      mode: "jasper",
      generatedServletPath: "analysis/generated-jsp-java/view/index_jsp.java",
      astPath: "analysis/jsp-ast/view/index.jsp.json"
    });

    expect(withAst.ast?.mode).toBe("jasper");
    expect(withAst.ast?.generatedServletPath).toContain("generated-jsp-java");
  });

  it("builds a nested document tree with custom tags and EL nodes", () => {
    const jsp = [
      `<div class="page">`,
      `  <c:if test="\${user != null}">`,
      `    Hello \${user.name}`,
      `    <my:query id="account.find">select * from account</my:query>`,
      `  </c:if>`,
      `</div>`
    ].join("\n");

    const parsed = parseJsp(jsp);
    const root = parsed.document;

    expect(root.kind).toBe("Document");
    expect(root.children[0]).toMatchObject({
      kind: "HtmlElement",
      tagName: "div",
      attributes: { class: "page" }
    });
    const htmlNode = root.children[0];
    if (htmlNode.kind !== "HtmlElement") {
      throw new Error("Expected HtmlElement root");
    }
    const ifNode = htmlNode.children.find((child) => child.kind === "CustomTagElement");
    expect(ifNode).toMatchObject({
      kind: "CustomTagElement",
      prefix: "c",
      name: "if"
    });
    if (!ifNode || ifNode.kind !== "CustomTagElement") {
      throw new Error("Expected CustomTagElement child");
    }
    expect(ifNode.lineRange).toMatchObject({
      startLine: 2,
      endLine: 5
    });
    expect(ifNode.children.some((child) => child.kind === "ElExpression")).toBe(true);
    expect(ifNode.children.some((child) => child.kind === "CustomTagElement" && child.name === "query")).toBe(true);
  });

  it("keeps malformed EL expressions as non-fatal fallback nodes", () => {
    const parsed = parseJsp(`Hello \${user ? }`);
    const elNode = parsed.document.children.find((child) => child.kind === "ElExpression");

    expect(elNode).toBeDefined();
    if (!elNode || elNode.kind !== "ElExpression") {
      throw new Error("Expected ElExpression node");
    }
    expect(["UnknownExpression", "RawExpression"]).toContain(elNode.ast.kind);
  });

  it("parses aggressive EL expressions", () => {
    const ast = parseEl(`\${empty user.items ? fn:length(defaults) : user.items[0].name}`);

    expect(ast.kind).toBe("TernaryExpression");
    if (ast.kind !== "TernaryExpression") {
      throw new Error("Expected ternary expression");
    }
    expect(ast.test.kind).toBe("UnaryExpression");
    expect(ast.consequent.kind).toBe("FunctionCallExpression");
    expect(ast.alternate.kind).toBe("PropertyAccessExpression");
  });
});
