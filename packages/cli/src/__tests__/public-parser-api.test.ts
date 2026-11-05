import fs from "fs/promises";
import childProcess from "child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJsp as workspaceParseJsp } from "@leflect-java/parser-jsp";
import { loadTldRegistry as workspaceLoadTldRegistry, parseTld as workspaceParseTld } from "@leflect-java/parser-tld";
import type {
  JspDocumentNode, JspParseOptions, JspParseResult, LineRange, LoadTldRegistryOptions,
  TldAttributeSchema, TldIndex, TldRegistryDiagnostic, TldRegistryEntry, TldRegistryTag
} from "../index";

type PublicApi = typeof import("../index");

function descendants(node: JspDocumentNode): JspDocumentNode[] {
  const attributes = "attributeNodes" in node ? node.attributeNodes ?? [] : [];
  const children = "children" in node ? node.children : [];
  return [node, ...attributes.flatMap(descendants), ...children.flatMap(descendants)];
}

function sourceRange(source: string, range: LineRange): string {
  const lines = source.split("\n");
  const offset = (line: number, column: number) => lines.slice(0, line - 1).reduce((n, text) => n + text.length + 1, 0) + column - 1;
  return source.slice(offset(range.startLine, range.startColumn), offset(range.endLine, range.endColumn) + 1);
}

describe("integrated public parser API", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("imports quietly and explicitly exposes the existing parser functions and analyzer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spawn = vi.spyOn(childProcess, "spawn");
    const api: PublicApi = await import("../index");
    expect(api.parseJsp).toBe(workspaceParseJsp);
    expect(api.parseTld).toBe(workspaceParseTld);
    expect(api.loadTldRegistry).toBe(workspaceLoadTldRegistry);
    expect(api.analyzeWorkspace).toBeTypeOf("function");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps synchronous JSP parsing and typed child/attribute/EL source ranges without IO", async () => {
    const api: PublicApi = await import("../index");
    const read = vi.spyOn(fs, "readFile");
    const walk = vi.spyOn(fs, "readdir");
    const stat = vi.spyOn(fs, "stat");
    const spawn = vi.spyOn(childProcess, "spawn");
    const options: JspParseOptions = { sourceKind: "jsp" };
    const source = '가😀\r\n<section><x:task code="${page.id}">ok</x:task></section>';
    const parsed: JspParseResult = api.parseJsp(source, options);
    expect(parsed).not.toBeInstanceOf(Promise);
    expect(parsed.document.kind).toBe("Document");
    expect(parsed.document.raw).toBe(source);
    const task = descendants(parsed.document).find(node => node.kind === "CustomTagElement");
    if (task?.kind !== "CustomTagElement") throw new Error("Expected a typed custom tag");
    expect(task.attributes).toEqual({ code: "${page.id}" });
    expect(task.children).toMatchObject([{ kind: "Text", text: "ok" }]);
    expect(task.lineRange).toEqual({ startLine: 2, startColumn: 10, endLine: 2, endColumn: 46 });
    const el = task.attributeNodes?.[0].children.find(node => node.kind === "ElExpression");
    if (el?.kind !== "ElExpression") throw new Error("Expected typed attribute EL");
    expect(el.ast.kind).toBe("PropertyAccessExpression");
    if (el.ast.kind === "PropertyAccessExpression") {
      expect(el.ast.target).toMatchObject({ kind: "IdentifierExpression", name: "page" });
      expect(el.ast.property).toBe("id");
    }
    for (const node of descendants(parsed.document)) expect(sourceRange(source, node.lineRange)).toBe(node.raw);
    expect(read).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps TLD string parsing synchronous with schema attribute types and no IO", async () => {
    const api: PublicApi = await import("../index");
    const read = vi.spyOn(fs, "readFile");
    const walk = vi.spyOn(fs, "readdir");
    const spawn = vi.spyOn(childProcess, "spawn");
    const xml = `<taglib><uri>urn:poc</uri><tag><name>task</name><tag-class>demo.TaskTag</tag-class><attribute><name>code</name><required>true</required><rtexprvalue>true</rtexprvalue><type>java.lang.String</type></attribute></tag></taglib>`;
    const parsed: TldIndex = api.parseTld(xml);
    const attribute: TldAttributeSchema = { name: "code", required: true, runtimeExpressionValue: true, type: "java.lang.String" };
    const tag: TldRegistryTag = { name: "task", handlerClass: "demo.TaskTag", attributes: [attribute] };
    const entry: TldRegistryEntry = { uri: "urn:poc", tags: [tag] };
    expect(parsed).not.toBeInstanceOf(Promise);
    expect(parsed).toMatchObject(entry);
    expect(read).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps the asynchronous registry contract and empty input scope", async () => {
    const api: PublicApi = await import("../index");
    const read = vi.spyOn(fs, "readFile");
    const walk = vi.spyOn(fs, "readdir");
    const stat = vi.spyOn(fs, "stat");
    const options: LoadTldRegistryOptions = { root: process.cwd(), repoFiles: [], configuredPaths: [], classpathEntries: [], autoLoad: true };
    const pending: Promise<{ entries: TldRegistryEntry[]; diagnostics: TldRegistryDiagnostic[] }> = api.loadTldRegistry(options);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual({ entries: [], diagnostics: [] });
    expect(read).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });
});
