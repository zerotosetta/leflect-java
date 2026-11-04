import { describe, expect, it } from "vitest";
import { buildGraphs } from "../index";

describe("JSP function coverage states", () => {
  it("keeps external standard tag handlers outside the function-only scope", () => {
    const result = buildGraphs([], [{
      path: "web/page.jsp", scriptlets: [], resolvedTags: [
        { prefix: "alias", name: "out", uri: "http://java.sun.com/jsp/jstl/core", handlerClass: "library.OutTag" },
        { prefix: "local", name: "out", uri: "http://java.sun.com/jsp/jstl/core", handlerClass: "demo.LocalTag" },
        { prefix: "c", name: "action", uri: "urn:custom", handlerClass: "library.CustomTag" }
      ]
    }], [{ id: "demo.LocalTag", name: "LocalTag", file: "src/LocalTag.java" }]);
    expect(result.jspJavaEdges.map(edge => edge.to).sort()).toEqual(["demo.LocalTag", "library.CustomTag"]);
    expect(result.jspJavaEdges.find(edge => edge.to === "demo.LocalTag")?.toFile).toBe("src/LocalTag.java");
  });

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
