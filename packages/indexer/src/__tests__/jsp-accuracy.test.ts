import { parseJsp } from "@leflect-java/parser-jsp";
import { describe, expect, it } from "vitest";

import { buildJspIndex, flattenJspFileMetadata } from "../jsp-index";
import { buildJspSemanticAsts } from "../jsp-semantic";
import type { JspSemanticNode } from "@leflect-java/schema";

function* nodes(node: JspSemanticNode): Iterable<JspSemanticNode> {
  yield node;
  for (const attribute of node.attributeNodes ?? []) yield* nodes(attribute);
  for (const child of node.children ?? []) yield* nodes(child);
}

describe("JSP semantic roles and provenance", () => {
  it("preserves attribute ownership, standard actions and verified tag file targets", async () => {
    const text = '<link href="<c:url value=\'/bank.css\'/>">\n<jsp:include page="/part.jsp"><jsp:param name="slot" value="header"/></jsp:include>\n<jsp:useBean id="today" class="java.util.Date"/>\n<bank:amount value="\${account.balance}"/>';
    const parsed = parseJsp(text);
    const file = "layout.jsp";
    const docs = [{
      path: file, ...parsed,
      resolvedTags: [{ prefix: "bank", name: "amount", uri: "urn:bank", tagFile: "WEB-INF/tags/amount.tag" }],
      includeReferences: [{ page: "/part.jsp", kind: "static" as const, targetPath: "part.jsp", location: { line: 2, column: 1 }, parameters: [{ name: "slot", value: "header", location: { line: 2, column: 35 } }] }],
      beanActions: [{ id: "today", className: "java.util.Date", actionDescription: "JSP bean", apiDescriptionStatus: "source-unavailable" as const, lineRange: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 59 } }]
    }];
    const [ast] = await buildJspSemanticAsts({ projectRoot: ".", analysisOut: ".", astMode: "lightweight", docs, registry: [] });
    const all = [...nodes(ast.root)];
    expect(all.filter(node => node.kind === "StandardActionNode").map(node => node.kind === "StandardActionNode" && node.action)).toEqual(["include", "param", "useBean"]);
    const amount = all.find(node => node.kind === "CustomTagNode" && node.sourceTag.name === "amount");
    expect(amount).toMatchObject({ tagFile: "WEB-INF/tags/amount.tag" });
    expect(all.find(node => node.kind === "AttributeNode" && node.name === "href")?.children).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "CustomTagNode" })]));
    expect(all.filter(node => node.kind === "ElExpressionNode")).toHaveLength(1);
  });

  it("retains tag-file declarations after persisted metadata flattening", () => {
    const parsed = parseJsp('<%@ tag body-content="empty" %><%@ attribute name="value" required="true" type="java.lang.Object" %>', { sourceKind: "tag" });
    const index = buildJspIndex([{ path: "amount.tag", ...parsed }]);
    expect(index.files[0]).toMatchObject({ sourceKind: "tag", tagAttributes: [{ name: "value", required: true, type: "java.lang.Object" }] });
    const file = { ...index.files[0], directives: parsed.directives, importEntries: [], taglibs: [], tags: [], scriptlets: [], classReferences: [], methodCalls: [] };
    expect(flattenJspFileMetadata([file]).docs[0]).toMatchObject({ sourceKind: "tag", tagAttributes: [{ name: "value" }], directives: parsed.directives });
  });

  it("keeps a missing tag-file failure and its TLD provenance in semantic AST", async () => {
    const parsed = parseJsp('<%@ taglib prefix="bank" uri="urn:bank" %>\n<bank:amount/>');
    const [ast] = await buildJspSemanticAsts({
      projectRoot: ".", analysisOut: ".", astMode: "lightweight",
      docs: [{ path: "page.jsp", ...parsed, resolvedTags: [{
        prefix: "bank", name: "amount", uri: "urn:bank",
        unresolvedReason: "Tag file target unavailable: /WEB-INF/tags/amount.tag"
      }] }],
      registry: [{ uri: "urn:bank", sourcePath: "WEB-INF/bank.tld", tags: [{ name: "amount", tagFilePath: "/WEB-INF/tags/amount.tag" }] }]
    });
    const tag = [...nodes(ast.root)].find(node => node.kind === "CustomTagNode");
    expect(tag).toMatchObject({
      declarationPath: "WEB-INF/bank.tld",
      unresolvedReason: "Tag file target unavailable: /WEB-INF/tags/amount.tag",
      lineRange: { startLine: 2, startColumn: 1 }
    });
    expect(tag && "tagFile" in tag && tag.tagFile).toBeUndefined();
  });
});
