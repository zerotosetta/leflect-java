import { describe, expect, it } from "vitest";
import { buildGraphs } from "../index";

describe("Java dependency identity", () => {
  it("promotes repeated static type qualifiers to one file dependency", () => {
    const result = buildGraphs([], [], [{ id: "demo.App", name: "App", file: "src/App.java" }], {
      javaClassReferences: [3, 4].map(line => ({
        file: "src/App.java", className: "DayOfWeek", classPath: "java.time.DayOfWeek",
        kind: "static-qualifier", snippet: "DayOfWeek", location: { line, column: 1 }
      }))
    });
    expect(result.javaTypeReferenceEdges).toHaveLength(1);
    expect(result.fileDependencies.files[0].references).toEqual([
      expect.objectContaining({ path: "java.time.DayOfWeek", nodeType: "external" })
    ]);
  });

  it("links nested declarations to files while keeping resolved external symbols distinct", () => {
    const result = buildGraphs([], [], [
      { id: "demo.Cms", name: "Cms", file: "src/Cms.java" },
      { id: "demo.Cms.Page", name: "Page", file: "src/Cms.java" },
      { id: "demo.App", name: "App", file: "src/App.java" }
    ], { javaClassReferences: [
      { file: "src/App.java", className: "Cms.Page", classPath: "demo.Cms.Page", kind: "type" },
      { file: "src/Cms.java", className: "Page", classPath: "demo.Cms.Page", kind: "new" },
      { file: "src/App.java", className: "HashMap", classPath: "java.util.HashMap", kind: "new" }
    ] });
    expect(result.fileEdges).toHaveLength(2);
    const app = result.fileDependencies.files.find(file => file.path === "src/App.java")!;
    expect(app.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/Cms.java", nodeType: "java" }),
      expect.objectContaining({ path: "java.util.HashMap", nodeType: "external" })
    ]));
  });

  it("does not bind a resolved external FQN to a same-named project class", () => {
    const result = buildGraphs([], [], [
      { id: "local.List", name: "List", file: "src/List.java" },
      { id: "local.App", name: "App", file: "src/App.java" }
    ], { javaClassReferences: [
      { file: "src/App.java", className: "List", classPath: "java.util.List", kind: "type" }
    ] });
    expect(result.javaTypeReferenceEdges[0]).toMatchObject({ to: "java.util.List", toFile: undefined });
  });

  it("records constructor delegation separately and preserves exact constructor symbols", () => {
    const result = buildGraphs([{
      fromClassId: "demo.Error",
      from: "demo.Error#Error(String)",
      fromFile: "src/Error.java",
      invocationKind: "super-constructor",
      toClassId: "java.lang.RuntimeException",
      to: "java.lang.RuntimeException",
      toMethodId: "java.lang.RuntimeException#<init>(java.lang.String)",
      resolvedMethodId: "java.lang.RuntimeException#<init>(java.lang.String)"
    }], [], [{ id: "demo.Error", name: "Error", file: "src/Error.java" }]);
    expect(result.javaCallEdges[0]).toMatchObject({
      type: "JAVA_CONSTRUCTOR_CALL", confidence: "high",
      toSymbol: "java.lang.RuntimeException#<init>(java.lang.String)"
    });
  });

  it("preserves a missing tag file diagnosis without inventing a target", () => {
    const reason = "Tag file target unavailable: /WEB-INF/tags/missing.tag";
    const result = buildGraphs([], [{
      path: "web/page.jsp", sourceKind: "jsp", scriptlets: [],
      resolvedTags: [{ prefix: "app", name: "missing", unresolvedReason: reason }]
    }], []);
    expect(result.jspJavaEdges[0]).toMatchObject({
      from: "web/page.jsp", to: "unresolved:tag:app:missing",
      type: "JSP_USES_TAG", confidence: "unresolved", unresolvedReason: reason
    });
    expect(result.jspJavaEdges[0].toFile).toBeUndefined();
  });
});
