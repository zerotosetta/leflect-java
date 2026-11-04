import fs from "fs/promises";
import path from "path";

import { expect, it } from "vitest";

import { analyzeWorkspace } from "@leflect-java/cli";
import { GraphEdge } from "@leflect-java/schema";
import { cleanupWorkspace, createFixtureWorkspace, readJsonFile, readJsonlFile } from "@leflect-java/testkit";

it("resolves tags through nested static includes and refreshes targets on incremental analysis", async () => {
  const workspace = await createFixtureWorkspace("custom-tag");
  try {
    const { root, analysisOut } = workspace;
    const page = "web/customerEdit.jsp";
    const fragment = path.join(root, "WEB-INF/taglibs.jspf");
    const tagFile = "WEB-INF/tags/card.tag";
    await fs.mkdir(path.join(root, "web/parts"), { recursive: true });
    await fs.mkdir(path.dirname(path.join(root, tagFile)), { recursive: true });
    await fs.writeFile(path.join(root, page), '<%@ include file="parts/setup.jspf" %>\n<app:form />\n<app:card />');
    await fs.writeFile(
      path.join(root, "web/parts/setup.jspf"),
      '<%@ include file="/WEB-INF/taglibs.jspf" %>\n<%@ include file="missing.jspf" %>'
    );
    await fs.writeFile(fragment, '<%@ taglib prefix="app" uri="urn:first" %>\n<%@ include file="/web/parts/setup.jspf" %>');
    await fs.writeFile(path.join(root, tagFile), "Card");
    for (const [name, handler] of [["first", "FirstTag"], ["second", "SecondTag"]]) {
      await fs.writeFile(path.join(root, `WEB-INF/${name}.tld`), [
        "<taglib>",
        `<uri>urn:${name}</uri>`,
        `<tag><name>form</name><tag-class>${handler}</tag-class></tag>`,
        `<tag-file><name>card</name><path>/${tagFile}</path></tag-file>`,
        "</taglib>"
      ].join(""));
    }
    const analyze = () => analyzeWorkspace({ root, analysisOut, jspAstMode: "lightweight", incremental: true });
    const readEdges = () => readJsonlFile<GraphEdge>(path.join(analysisOut, "graph/jsp-java.jsonl"));

    await analyze();
    expect(await readJsonFile(path.join(analysisOut, "jsp-meta", `${tagFile}.json`)))
      .toMatchObject({ sourceKind: "tag", ast: { mode: "lightweight" } });
    expect(await readJsonFile(path.join(analysisOut, "jsp-meta", "web/parts/setup.jspf.json")))
      .toMatchObject({ sourceKind: "jspf" });
    expect(await readEdges()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: page, to: "FirstTag", confidence: "high", fromLocation: expect.objectContaining({ line: 2, column: 1 })
      }),
      expect.objectContaining({ from: page, toFile: tagFile, type: "JSP_USES_TAG_FILE", confidence: "high" })
    ]));
    const diagnostics = await readJsonFile<unknown[]>(path.join(analysisOut, "logs/jsp-include-diagnostics.json"));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ page, code: "include-cycle" }),
      expect.objectContaining({ page, code: "missing-include", target: "missing.jspf" })
    ]));
    const cached = await analyze();
    expect(cached.stages.find((stage) => stage.stage === "parse-jsp")?.status).toBe("skipped");

    await fs.writeFile(fragment, '<%@ taglib prefix="app" uri="urn:second" %>');
    await fs.unlink(path.join(root, tagFile));
    const revised = await analyze();
    expect(revised.stages.find((stage) => stage.stage === "parse-jsp")?.processedFiles).toBe(3);
    expect(await fs.access(path.join(analysisOut, "jsp-meta", `${tagFile}.json`)).then(() => true, () => false)).toBe(false);
    const updated = await readEdges();
    expect(updated).not.toEqual(expect.arrayContaining([expect.objectContaining({ to: "FirstTag" })]));
    expect(updated).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: page, to: "SecondTag", confidence: "high" }),
      expect.objectContaining({ from: page, confidence: "unresolved", unresolvedReason: `Tag file target unavailable: /${tagFile}` })
    ]));
  } finally {
    await cleanupWorkspace(workspace);
  }
}, 60_000);
