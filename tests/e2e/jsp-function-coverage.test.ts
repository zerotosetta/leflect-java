import fs from "fs/promises";
import os from "os";
import path from "path";
import { expect, it } from "vitest";
import { analyzeWorkspace } from "@leflect-java/cli";

it("persists disabled standard-function coverage without reporting a false unresolved edge", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-function-coverage-"));
  const analysisOut = path.join(root, "analysis");
  const configPath = path.join(root, "leflect.config.json");
  const uri = "http://java.sun.com/jsp/jstl/functions";
  const read = async (file: string) => JSON.parse(await fs.readFile(path.join(analysisOut, file), "utf8"));
  try {
    await fs.mkdir(path.join(root, "web"));
    await fs.writeFile(configPath, JSON.stringify({ jsp: { webappRoot: "web", astMode: "lightweight", tld: { autoLoad: false } } }));
    await fs.writeFile(path.join(root, "web/page.jsp"), `<%@ taglib prefix="alias" uri="${uri}" %>\n<p>${'${alias:length(items)}'}</p>`);
    await analyzeWorkspace({ root, configPath, analysisOut, jspAstMode: "lightweight" });
    const metadata = await read("index/jsp/web/page.jsp.json");
    expect(metadata.functionCalls).toEqual([expect.objectContaining({
      prefix: "alias", name: "length", uri, validation: "excluded", excludedReason: expect.stringContaining("disabled"),
      location: { line: 2, column: 6, endLine: 2, endColumn: 17 }
    })]);
    expect(await read("logs/jsp-function-diagnostics.json")).toEqual([expect.objectContaining({
      path: "web/page.jsp", severity: "info", category: "jsp.function.excluded", name: "length", message: expect.stringContaining("disabled")
    })]);
    expect((await read("report/unresolved.json")).edges).toEqual([]);
    expect(await fs.readFile(path.join(analysisOut, "graph/jsp-java.jsonl"), "utf8")).toBe("");
    await analyzeWorkspace({ root, configPath, analysisOut, jspAstMode: "lightweight", incremental: true });
    expect((await read("index/jsp/web/page.jsp.json")).functionCalls[0]).toMatchObject({ validation: "excluded" });
    expect((await read("report/unresolved.json")).edges).toEqual([]);

    await fs.writeFile(configPath, JSON.stringify({ jsp: { webappRoot: "web", astMode: "lightweight", tld: { autoLoad: true } } }));
    await analyzeWorkspace({ root, configPath, analysisOut, jspAstMode: "lightweight", incremental: true });
    const missing = (await read("index/jsp/web/page.jsp.json")).functionCalls[0];
    expect(missing).toMatchObject({ validation: "unresolved", unresolvedReason: expect.stringContaining("No TLD registered") });
    expect(await read("logs/jsp-function-diagnostics.json")).toEqual([expect.objectContaining({ severity: "warning", category: "jsp.function.unresolved" })]);
    expect((await read("report/unresolved.json")).edges).toHaveLength(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
