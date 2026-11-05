import { describe, expect, it } from "vitest";
import { buildJavaIndex, JavaSummaryClassReference } from "../java-index";

const file = "src/demo/Example.java";
const location = (line: number) => ({ line, column: 1, endLine: line, endColumn: 27 });
const reference = (name: string, line: number, wildcard = false, isStatic = false): JavaSummaryClassReference => ({
  symbol: name, qualifiedName: name, kind: wildcard ? "import-wildcard" : "import",
  snippet: `import ${isStatic ? "static " : ""}${name}${wildcard ? ".*" : ""};`, location: location(line)
});

describe("Java import declaration positions", () => {
  it("uses exact original ranges for wildcard and explicit imports without external libraries", () => {
    const index = buildJavaIndex({ files: [file], summaries: [{ path: file,
      imports: ["javax.servlet.*", "javax.servlet.http.*", "java.util.Map"],
      classReferences: [reference("javax.servlet", 2, true), reference("javax.servlet.http", 3, true), reference("java.util.Map", 4)]
    }] });
    expect(index.imports.map(row => [row.import, row.location?.line])).toEqual([
      ["java.util.Map", 4], ["javax.servlet.*", 2], ["javax.servlet.http.*", 3]
    ]);
    expect(index.imports.every(row => row.id === `java-import:${file}:${row.import}`)).toBe(true);
    expect(index.files[0].referenceDiagnostics).toBeUndefined();
  });

  it("accepts raw static declarations from workers that omit the static summary prefix", () => {
    const index = buildJavaIndex({ files: [file], summaries: [{ path: file,
      imports: ["java.lang.Math.*", "static java.util.Collections.emptyList"],
      classReferences: [reference("java.lang.Math", 2, true, true), reference("java.util.Collections.emptyList", 3, false, true)]
    }] });
    expect(index.imports.map(row => row.location?.line)).toEqual([2, 3]);
    expect(index.imports[0].import).toBe("java.lang.Math.*");
  });

  it("does not assign a parent-package range to a missing or ambiguous declaration", () => {
    const index = buildJavaIndex({ files: [file], summaries: [{ path: file,
      imports: ["javax.servlet.http.*", "example.Outer.Inner"],
      classReferences: [reference("javax.servlet", 2, true), reference("example.Outer.Inner", 4), reference("example.Outer.Inner", 5, false, true)]
    }] });
    expect(index.imports.every(row => row.location === undefined)).toBe(true);
    expect(index.files[0].referenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ snippet: "javax.servlet.http.*", message: "Import declaration source location is unavailable" }),
      expect.objectContaining({ snippet: "example.Outer.Inner", message: "Ambiguous import declaration source location" })
    ]));
  });
});
