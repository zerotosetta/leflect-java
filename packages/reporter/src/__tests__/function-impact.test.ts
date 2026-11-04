import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@leflect-java/schema";
import { buildReports, formatJspImpactResult, queryJavaUsages, queryJspImpact, type ReporterInput } from "../index";

describe("EL function impact and usage reports", () => {
  it("projects every function occurrence into summaries while deduplicating target classes and caller files", () => {
    const web = "demo.bank.Web";
    const functions = "org.apache.taglibs.standard.functions.Functions";
    const custom = [
      ["web/login.jsp", "bank:sha256", "sha256(java.lang.String)", 5],
      ["web/ledger.jsp", "bank:entryLabel", "entryLabel(java.lang.Object)", 69],
      ["web/tags/csrf.tag", "bank:csrfToken", "csrf(javax.servlet.http.HttpServletRequest)", 3],
      ["web/tags/status.tag", "bank:statusLabel", "statusLabel(java.lang.Object)", 7]
    ] as const;
    const edge = (file: string, target: string, symbol: string, method: string, line: number, toFile?: string): GraphEdge => ({
      from: file, fromFile: file, to: target, toFile, type: "JSP_FUNCTION_CALL", confidence: "high",
      fromSymbol: symbol, toSymbol: target + "#" + method,
      fromLocation: { line, column: 8, endLine: line, endColumn: 8 + symbol.length - 1 }
    });
    const edges: GraphEdge[] = [
      ...custom.map(([file, symbol, method, line]) => edge(file, web, symbol, method, line, "src/Web.java")),
      edge("web/login.jsp", web, "bank:sha256", "sha256(java.lang.String)", 9, "src/Web.java"),
      edge("web/library.jsp", functions, "alias:escapeXml", "escapeXml(java.lang.String)", 2),
      edge("web/library.jsp", functions, "fn:length", "length(java.lang.Object)", 5),
      { from: "web/broken.jsp", fromFile: "web/broken.jsp", to: web, type: "JSP_FUNCTION_CALL",
        confidence: "unresolved", fromSymbol: "bank:missing", unresolvedReason: "Missing function declaration" }
    ];
    const excludedDocument = { path: "web/excluded.jsp", sourceKind: "jsp", functionCalls: [
      { prefix: "fn", name: "length", validation: "excluded", excludedReason: "Classpath TLD collection disabled" }
    ] };
    const input: ReporterInput = {
      classes: [{ id: web, name: "Web", file: "src/Web.java" }], methods: [],
      jsps: [...custom.map(([file]) => ({ path: file, sourceKind: file.endsWith(".tag") ? "tag" : "jsp" })),
        { path: "web/library.jsp", sourceKind: "jsp" }, { path: "web/broken.jsp", sourceKind: "jsp" },
        excludedDocument],
      taglibs: [], reverseIndex: { handlerToJsp: {} }, javaCallEdges: [], jspJavaEdges: edges, diagnostics: []
    };
    const before = JSON.stringify(edges);
    const login = queryJspImpact(input, "web/login.jsp");
    expect(login.javaTargets).toEqual([web]);
    expect(login.externalJavaTargets).toEqual([]);
    expect(login.functionReferences).toEqual([edges[0], edges[4]]);
    expect(login.functionUsageCount).toBe(2);
    expect(queryJavaUsages(input, "Web").jspCallers).toEqual(custom.map(([file]) => file).sort());
    expect(queryJavaUsages(input, functions).jspCallers).toEqual(["web/library.jsp"]);

    const external = queryJspImpact(input, "web/library.jsp");
    expect(external.javaTargets).toEqual([functions]);
    expect(external.externalJavaTargets).toEqual([functions]);
    expect(external.tagHandlers).toEqual([]);
    expect(external.functionReferences).toEqual([edges[5], edges[6]]);
    expect(external.functionUsageCount).toBe(2);
    expect(queryJspImpact(input, "web/broken.jsp")).toMatchObject({
      javaTargets: [], externalJavaTargets: [], functionReferences: [], functionUsageCount: 0, unresolvedTargets: [web]
    });
    expect(queryJspImpact(input, "web/excluded.jsp")).toMatchObject({ javaTargets: [], functionReferences: [] });

    const reports = buildReports(input);
    for (const [file] of custom) {
      expect(reports.summary.jspImpacts).toContainEqual(expect.objectContaining({ jspPath: file, javaTargets: [web] }));
    }
    expect(reports.summary.jspImpacts.find(row => row.jspPath === "web/tags/csrf.tag")?.functionReferences?.[0]).toMatchObject({
      fromSymbol: "bank:csrfToken", toSymbol: web + "#csrf(javax.servlet.http.HttpServletRequest)", fromLocation: { line: 3, column: 8 }
    });
    expect(reports.summary.jspImpacts.find(row => row.jspPath === "web/library.jsp")).toMatchObject({
      javaTargets: [functions], externalJavaTargets: [functions], functionUsageCount: 2
    });
    expect(reports.summary.jspImpacts.some(row => row.jspPath === "web/excluded.jsp")).toBe(false);
    expect(reports.impactMarkdown).toContain(web + "#sha256(java.lang.String)");
    expect(reports.impactMarkdown).toContain(functions + "#length(java.lang.Object)");
    expect(reports.impactMarkdown).toContain("web/tags/csrf.tag");
    expect(formatJspImpactResult(login)).toContain("web/login.jsp:5:8-5:18");
    expect(formatJspImpactResult(external)).toContain("External Java targets: " + functions);
    expect(JSON.stringify(edges)).toBe(before);
  });
});
