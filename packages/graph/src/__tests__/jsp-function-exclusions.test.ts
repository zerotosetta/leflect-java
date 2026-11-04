import { describe, expect, it } from "vitest";
import { buildGraphs } from "../index";

describe("JSP function coverage states", () => {
  it("keeps excluded functions out of both resolved and unresolved graph edges", () => {
    const location = { line: 2, column: 3, endLine: 2, endColumn: 12 };
    const result = buildGraphs([], [{
      path: "web/page.jsp", scriptlets: [], functionCalls: [
        { prefix: "fn", name: "excluded", className: "library.Excluded", methodId: "library.Excluded#call()",
          validation: "excluded", excludedReason: "Classpath TLD collection is disabled", location },
        { prefix: "fn", name: "missing", validation: "unresolved", unresolvedReason: "Missing TLD", location },
        { prefix: "fn", name: "resolved", className: "library.Functions", methodId: "library.Functions#call()",
          validation: "classpath", location }
      ]
    }], []);
    expect(result.jspJavaEdges).toHaveLength(2);
    expect(result.jspJavaEdges.find(edge => edge.fromSymbol === "fn:missing")).toMatchObject({
      type: "JSP_FUNCTION_CALL", confidence: "unresolved", unresolvedReason: "Missing TLD"
    });
    expect(result.jspJavaEdges.find(edge => edge.fromSymbol === "fn:resolved")).toMatchObject({
      type: "JSP_FUNCTION_CALL", confidence: "high", to: "library.Functions"
    });
    expect(result.fileEdges.some(edge => edge.to === "library.Excluded")).toBe(false);
  });
});
