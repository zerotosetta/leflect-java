import { describe, expect, it } from "vitest";

import { JspDocumentNode, parseJsp } from "../parse";

function descendants(node: JspDocumentNode): JspDocumentNode[] {
  const attributes = "attributeNodes" in node ? node.attributeNodes ?? [] : [];
  const children = "children" in node ? node.children : [];
  return [node, ...attributes.flatMap(descendants), ...children.flatMap(descendants)];
}

describe("JSP source structure", () => {
  it("closes HTML void elements at the start tag while preserving container siblings", () => {
    const parsed = parseJsp('<section><INPUT value="x > y"><meta charset="UTF-8"><link href="x"><span>after</span></section>');
    const section = parsed.document.children[0];
    expect(section.kind).toBe("HtmlElement");
    if (section.kind !== "HtmlElement") throw new Error("Expected section");
    expect(section.children.map((node) => node.kind === "HtmlElement" ? node.tagName : node.kind))
      .toEqual(["INPUT", "meta", "link", "span"]);
    for (const node of section.children.slice(0, 3)) {
      expect(node).toMatchObject({ selfClosing: true, children: [] });
      expect(node.raw.endsWith(">")).toBe(true);
    }
    const xml = parseJsp("<input><span>x</span></input>", { syntax: "xml" }).document.children[0];
    expect(xml).toMatchObject({ selfClosing: false });
    expect("children" in xml && xml.children[0]).toMatchObject({ tagName: "span" });
  });

  it("keeps conditional attribute EL as one expression instead of boolean attribute fragments", () => {
    const parsed = parseJsp('<option value="${item.id}" ${selected eq item.id ? \'selected\' : \'\'}>item</option>');
    const option = parsed.document.children[0];
    expect(option).toMatchObject({ attributes: { value: "${item.id}" } });
    expect("attributeNodes" in option && option.attributeNodes).toHaveLength(2);
    const expressions = descendants(parsed.document).filter((node) => node.kind === "ElExpression");
    expect(expressions).toHaveLength(2);
    expect(expressions[1]).toMatchObject({ ast: { kind: "TernaryExpression" } });
    expect(parsed.document.diagnostics).toEqual([]);
  });

  it("keeps mixed attribute values and nested JSP tags in attribute source order", () => {
    const source = '<a title="Hello ${person.name}!" href="<c:url value=\'/x\'/>">body</a>';
    const parsed = parseJsp(source);
    const anchor = parsed.document.children[0];
    if (anchor.kind !== "HtmlElement") throw new Error("Expected anchor");
    const title = anchor.attributeNodes?.find((node) => node.name === "title");
    expect(title?.children.map((node) => node.kind)).toEqual(["Text", "ElExpression", "Text"]);
    const href = anchor.attributeNodes?.find((node) => node.name === "href");
    expect(href?.children).toHaveLength(1);
    expect(href?.children[0]).toMatchObject({ kind: "CustomTagElement", prefix: "c", name: "url", raw: "<c:url value='/x'/>" });
    expect(anchor.children).toMatchObject([{ kind: "Text", text: "body" }]);
    expect(descendants(parsed.document).filter((node) => node.kind === "CustomTagElement")).toHaveLength(1);
  });

  it("recognizes nested tag quotes independently of the containing attribute quote", () => {
    const parsed = parseJsp('<link href="<c:url value="/bank.css"/>"><p>after</p>');
    const [link, paragraph] = parsed.document.children;
    expect(link).toMatchObject({ tagName: "link", selfClosing: true, children: [] });
    if (link.kind !== "HtmlElement") throw new Error("Expected link");
    expect(link.attributeNodes?.[0].children[0]).toMatchObject({
      kind: "CustomTagElement", attributes: { value: "/bank.css" }
    });
    expect(paragraph).toMatchObject({ tagName: "p", children: [{ text: "after" }] });
  });

  it("preserves a broken attribute owner and recovers the following markup", () => {
    const parsed = parseJsp('<a href="broken\n<p>after</p>');
    expect(parsed.document.children[0]).toMatchObject({ tagName: "a", incomplete: true });
    expect(parsed.document.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "incomplete-tag", lineRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 } })
    ]));
    const paragraph = descendants(parsed.document).find((node) => node.kind === "HtmlElement" && node.tagName === "p");
    expect(paragraph).toMatchObject({ lineRange: { startLine: 2 }, children: [{ text: "after" }] });
  });

  it("diagnoses incomplete and unsupported EL without swallowing later elements", () => {
    const parsed = parseJsp('${value\n<p>after</p>');
    expect(parsed.document.children[0]).toMatchObject({ kind: "ElExpression", incomplete: true, raw: "${value" });
    expect(descendants(parsed.document).some((node) => node.kind === "HtmlElement" && node.tagName === "p")).toBe(true);
    expect(parsed.document.diagnostics?.some((diagnostic) => diagnostic.code === "incomplete-el")).toBe(true);
    expect(parseJsp("${x +}").document.diagnostics?.some((diagnostic) => diagnostic.code === "unsupported-el")).toBe(true);
  });

  it("recovers sibling markup on the same line after incomplete attributes and EL", () => {
    for (const source of ['<a href="broken<p>after</p>', '<input value="${broken"><p>after</p>']) {
      const parsed = parseJsp(source);
      const [owner, paragraph] = parsed.document.children;
      expect(owner).toMatchObject({ incomplete: true, attributeNodes: [{ incomplete: true }] });
      expect(paragraph).toMatchObject({ tagName: "p", children: [{ text: "after" }] });
      expect(parsed.document.diagnostics?.some((diagnostic) => diagnostic.code === "incomplete-tag")).toBe(true);
      if (source.includes("${")) {
        expect(descendants(owner).find((node) => node.kind === "ElExpression")).toMatchObject({ raw: "${broken", incomplete: true });
        expect(parsed.document.diagnostics?.some((diagnostic) => diagnostic.code === "incomplete-el")).toBe(true);
      }
    }
  });

  it("keeps quoted JSP expressions inside one attribute with their full code", () => {
    const parsed = parseJsp('<input value="<%= "hello" %>"><p>after</p>');
    const [input, paragraph] = parsed.document.children;
    expect(input).toMatchObject({ attributes: { value: '<%= "hello" %>' }, attributeNodes: [{
      name: "value", children: [{ kind: "Expression", code: '"hello"' }]
    }] });
    expect(paragraph).toMatchObject({ tagName: "p", children: [{ text: "after" }] });
    expect(parsed.document.diagnostics).toEqual([]);
  });

  it("preserves ordinary angle-bracket text inside an attribute without creating HTML elements", () => {
    const parsed = parseJsp('<input title="x <y> z"><p>after</p>');
    expect(parsed.document.children[0]).toMatchObject({ attributes: { title: "x <y> z" }, attributeNodes: [{
      name: "title", children: [{ kind: "Text", text: "x <y> z" }]
    }] });
    expect(parsed.document.children[1]).toMatchObject({ tagName: "p", children: [{ text: "after" }] });
    expect(descendants(parsed.document).filter((node) => node.kind === "HtmlElement")).toHaveLength(2);
    expect(parsed.document.diagnostics).toEqual([]);
  });

  it("records tag-file declarations and attributes independently of JSP pages", () => {
    const parsed = parseJsp('<%@ tag body-content="empty" %>\n<%@ attribute name="value" required="true" type="java.lang.Object" %>\n<fmt:formatNumber value="${empty value ? 0 : value}"/>', { sourceKind: "tag" });
    expect(parsed.sourceKind).toBe("tag");
    expect(parsed.directives.map((directive) => directive.kind)).toEqual(["tag", "attribute"]);
    expect(parsed.tagAttributes).toEqual([{ name: "value", required: true, type: "java.lang.Object", runtimeExpressionValue: true }]);
    expect(descendants(parsed.document).filter((node) => node.kind === "ElExpression")).toHaveLength(1);
  });
});
