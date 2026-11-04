import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@leflect-java/schema";
import { buildReports, formatJspImpactResult, queryJspImpact, type ReporterInput } from "../index";

describe("JSP file impact accuracy", () => {
  it("keeps repeated file uses and positions separately from unique target files", () => {
    const file = "web/page.jsp";
    const edges: GraphEdge[] = [
      ...[2, 4].map((line) => ({ from: file, to: "web/tags/amount.tag", toFile: "web/tags/amount.tag",
        type: "JSP_USES_TAG_FILE" as const, confidence: "high" as const, fromLocation: { line, column: 3 } })),
      ...[6, 8, 10, 12].map((line) => ({ from: file, to: "web/common/area.jsp", toFile: "web/common/area.jsp",
        type: "JSP_INCLUDES" as const, confidence: "high" as const, fromLocation: { line, column: 5 } })),
      { from: file, to: "unresolved:include:${page}", type: "JSP_INCLUDES", confidence: "unresolved", fromLocation: { line: 14, column: 5 } },
      { from: file, to: "demo.FormTag", type: "JSP_USES_TAG", confidence: "high" }
    ];
    const input: ReporterInput = {
      classes: [], methods: [], jsps: [{ path: file, sourceKind: "jsp" }, { path: "web/tags/amount.tag", sourceKind: "tag" },
        { path: "web/common/taglibs.jspf", sourceKind: "jspf" }], taglibs: [], reverseIndex: { handlerToJsp: {} },
      javaCallEdges: [], jspJavaEdges: edges, diagnostics: []
    };
    const result = queryJspImpact(input, "web\\page.jsp");
    expect(result.fileTargets).toEqual(["web/common/area.jsp", "web/tags/amount.tag"]);
    expect(result.fileUsageCount).toBe(6);
    expect(result.fileReferences?.map((edge) => edge.fromLocation?.line)).toEqual([2, 4, 6, 8, 10, 12]);
    expect(result.tagHandlers).toEqual(["demo.FormTag"]);
    expect(result.unresolvedTargets).toEqual(["unresolved:include:${page}"]);
    const reports = buildReports(input);
    expect(reports.summary.counts.jsps).toBe(1);
    expect(reports.summary.counts.jspJavaEdges).toBe(1);
    expect(reports.summary.jspImpacts).toContainEqual(expect.objectContaining({
      jspPath: file, fileTargets: result.fileTargets, fileReferences: result.fileReferences, fileUsageCount: 6
    }));
    expect(reports.impactMarkdown).toContain("web/tags/amount.tag");
    expect(formatJspImpactResult(result)).toContain("File reference uses: 6");
  });

  it("includes pages whose only dependencies are file references", () => {
    const input: ReporterInput = {
      classes: [], methods: [], jsps: [{ path: "web/only.jsp" }], taglibs: [], reverseIndex: { handlerToJsp: {} },
      javaCallEdges: [], jspJavaEdges: [{ from: "web/only.jsp", to: "web/only.tag", type: "JSP_USES_TAG_FILE", confidence: "high" }], diagnostics: []
    };
    expect(buildReports(input).summary.jspImpacts).toEqual([expect.objectContaining({
      jspPath: "web/only.jsp", javaTargets: [], tagHandlers: [], fileTargets: ["web/only.tag"], fileUsageCount: 1
    })]);
  });
});
