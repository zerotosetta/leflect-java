import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildJavaIndex, JavaSummaryClassReference, JavaSummaryMethodCall } from "../java-index";

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

describe("Java import provenance", () => {
  const type = (spelling: string, qualifiedName: string, line: number): JavaSummaryClassReference => ({
    symbol: spelling, snippet: spelling, qualifiedName, kind: "type", location: location(line)
  });
  const buildTypes = (imports: string[], refs: JavaSummaryClassReference[]) => buildJavaIndex({ files: [file], summaries: [{
    path: file, packageName: "demo", imports, types: [{ name: "Example", fqn: "demo.Example" }],
    classReferences: [...imports.map((entry, i) => reference(entry.replace(/\.\*$/, ""), i + 1, entry.endsWith(".*"))), ...refs]
  }] }).classReferences.filter(ref => ref.kind === "type");

  it("binds exact packages and generic bases while preserving original resolved type information", () => {
    const refs = buildTypes(["javax.servlet.*", "javax.servlet.http.*", "java.util.ArrayList"], [
      type("HttpServlet", "javax.servlet.http.HttpServlet", 7),
      type("ArrayList<Map<String,Object>>", "java.util.ArrayList<java.util.Map<java.lang.String,java.lang.Object>>", 8)
    ]);
    expect(refs.map(ref => [ref.importId, ref.originKind])).toEqual(expect.arrayContaining([
      [`java-import:${file}:javax.servlet.http.*`, "on-demand-import"],
      [`java-import:${file}:java.util.ArrayList`, "explicit-import"]
    ]));
    expect(refs.find(ref => ref.className.startsWith("ArrayList"))?.qualifiedName).toBe("java.util.ArrayList<java.util.Map<java.lang.String,java.lang.Object>>");
    expect(buildTypes(["javax.servlet.*"], [type("HttpServlet", "javax.servlet.http.HttpServlet", 7)])[0]).toMatchObject({
      originKind: "unresolved", originStatus: "unresolved", importId: undefined
    });
  });

  it("uses the written outer type for nested types without guessing subpackages or duplicate declarations", () => {
    expect(buildTypes(["java.util.Map"], [type("Map.Entry<String,Object>", "java.util.Map.Entry<java.lang.String,java.lang.Object>", 7)])[0])
      .toMatchObject({ importId: `java-import:${file}:java.util.Map`, originKind: "explicit-import" });
    expect(buildTypes(["java.util.*"], [type("Map.Entry", "java.util.Map.Entry", 7)])[0])
      .toMatchObject({ importId: `java-import:${file}:java.util.*`, originKind: "on-demand-import" });
    expect(buildTypes(["java.util.*"], [type("Entry", "java.util.Map.Entry", 7)])[0])
      .toMatchObject({ importId: undefined, originStatus: "unresolved" });
    const ambiguous = buildJavaIndex({ files: [file], summaries: [{ path: file,
      imports: ["java.util.Map.Entry", "static java.util.Map.Entry"],
      classReferences: [reference("java.util.Map.Entry", 1), reference("java.util.Map.Entry", 2, false, true), type("Entry", "java.util.Map.Entry", 7)]
    }] }).classReferences.find(ref => ref.kind === "type");
    expect(ambiguous).toMatchObject({ importId: undefined, originStatus: "ambiguous", originEvidence: {
      candidateImportIds: [`java-import:${file}:java.util.Map.Entry`, `java-import:${file}:static java.util.Map.Entry`]
    } });
  });

  it("keeps FQN, same-package, java.lang, and enclosing source types independent from incidental wildcard imports", () => {
    const refs = buildTypes(["java.util.*", "demo.*", "java.lang.*"], [
      type("java.util.Map<String,Object>", "java.util.Map<java.lang.String,java.lang.Object>", 7),
      type("Other", "demo.Other", 8), type("String", "java.lang.String", 9), type("Example", "demo.Example", 10)
    ]);
    expect(refs.every(ref => ref.importId === undefined && ref.originStatus === "not-required")).toBe(true);
    expect(refs.map(ref => ref.originKind).sort()).toEqual(["fully-qualified", "java-lang", "local-type", "same-package"]);
  });

  it("binds calls through actual receiver declarations rather than inherited method owners", () => {
    const receiver = { receiverOriginKind: "receiver-declaration" as const, receiverType: "javax.servlet.http.HttpServletRequest",
      receiverTypeSpelling: "HttpServletRequest", receiverDeclarationFile: file, receiverDeclarationLocation: location(7) };
    const call = (target: string, extra: Partial<JavaSummaryMethodCall>): JavaSummaryMethodCall => ({
      callerMethodId: "demo.Example#run()", target, location: location(20), ...extra
    });
    const calls = buildJavaIndex({ files: [file], summaries: [{ path: file, imports: ["javax.servlet.*", "javax.servlet.http.*"],
      methodCalls: [
        call("javax.servlet.ServletRequest#setAttribute(java.lang.String,java.lang.Object)", receiver),
        call("javax.servlet.ServletRequest#getAttribute(java.lang.String)", { ...receiver, receiverDeclarationFile: "src/demo/Base.java" }),
        call("java.io.PrintWriter#write(java.lang.String)", { receiverOriginKind: "receiver-call", receiverType: "java.io.PrintWriter" }),
        call("javax.servlet.http.HttpServlet#getServletContext()", { receiverOriginKind: "inherited" }),
        call("javax.servlet.http.HttpServletRequest#getMethod()", {})
      ]
    }] }).calls;
    const bound = calls.find(call => call.methodName === "setAttribute")!;
    expect(bound).toMatchObject({ importId: `java-import:${file}:javax.servlet.http.*`, resolvedClassId: "javax.servlet.ServletRequest",
      originKind: "receiver-declaration", originStatus: "resolved", originEvidence: { file, location: location(7), importKind: "on-demand-import" } });
    expect(calls.filter(call => call !== bound).every(call => call.importId === undefined)).toBe(true);
    expect(calls.find(call => call.methodName === "getMethod")).toMatchObject({ originKind: "unresolved", originStatus: "unresolved" });
    expect(calls.find(call => call.methodName === "getServletContext")).toMatchObject({ originKind: "inherited", originStatus: "not-required" });
  });

  it("distinguishes imported static owners from fully qualified owner expressions", () => {
    const calls = buildJavaIndex({ files: [file], summaries: [{ path: file, imports: ["java.util.Collections"], methodCalls: [
      { target: "java.util.Collections#emptyList()", location: location(8), receiverOriginKind: "static-owner",
        receiverType: "java.util.Collections", receiverTypeSpelling: "Collections" },
      { target: "java.util.Collections#emptyList()", location: location(9), receiverOriginKind: "static-owner",
        receiverType: "java.util.Collections", receiverTypeSpelling: "java.util.Collections" }
    ] }] }).calls;
    expect(calls[0]).toMatchObject({ importId: `java-import:${file}:java.util.Collections`, originKind: "static-owner", originStatus: "resolved" });
    expect(calls[1]).toMatchObject({ importId: undefined, originKind: "static-owner", originStatus: "not-required",
      originEvidence: { importKind: "fully-qualified" } });
  });

  const staticCall = (extra: Partial<JavaSummaryMethodCall> = {}): JavaSummaryMethodCall => ({
    target: "java.util.Collections#emptyList()", receiverOriginKind: "static-import",
    receiverType: "java.util.Collections", receiverTypeSpelling: "emptyList",
    receiverDeclarationFile: file, receiverDeclarationLocation: location(2), location: location(8), ...extra
  });
  const buildStaticCalls = (imports: string[], calls: JavaSummaryMethodCall[]) => buildJavaIndex({ files: [file], summaries: [{
    path: file, imports, methodCalls: calls, classReferences: imports.map((entry, i) => {
      const spelling = entry.replace(/^static /, "");
      return reference(spelling.replace(/\.\*$/, ""), i + 2, spelling.endsWith(".*"), true);
    })
  }] }).calls;

  it("links unqualified static methods to exact explicit or on-demand static declarations", () => {
    // The explicit case also covers older summaries whose import spelling omits static.
    const explicit = buildStaticCalls(["java.util.Collections.emptyList"], [staticCall()])[0];
    expect(explicit).toMatchObject({ importId: `java-import:${file}:java.util.Collections.emptyList`,
      originKind: "static-import", originStatus: "resolved", originEvidence: {
        spelling: "emptyList", type: "java.util.Collections", file, location: location(2), importKind: "explicit-import"
      } });
    const wildcard = buildStaticCalls(["static java.util.Collections.*"], [staticCall()])[0];
    expect(wildcard).toMatchObject({ importId: `java-import:${file}:static java.util.Collections.*`,
      originKind: "static-import", originStatus: "resolved", originEvidence: { importKind: "on-demand-import", location: location(2) } });
  });

  it("keeps overlapping static declaration evidence ambiguous without choosing a declaration", () => {
    const call = buildStaticCalls(["static java.util.Collections.emptyList", "static java.util.Collections.*"], [staticCall()])[0];
    expect(call).toMatchObject({ importId: undefined, originKind: "ambiguous", originStatus: "ambiguous", originEvidence: {
      candidateImportIds: [`java-import:${file}:static java.util.Collections.*`, `java-import:${file}:static java.util.Collections.emptyList`],
      reason: "Multiple static declarations support this resolved unqualified method"
    } });
  });

  it("does not borrow static imports for ordinary own or inherited unqualified calls", () => {
    const calls = buildStaticCalls(["static java.util.Collections.emptyList"], [
      staticCall({ target: "demo.Example#emptyList()", receiverOriginKind: "local" }),
      staticCall({ target: "demo.Base#emptyList()", receiverOriginKind: "inherited" })
    ]);
    expect(calls.map(call => [call.originKind, call.originStatus, call.importId])).toEqual([
      ["inherited", "not-required", undefined], ["local-type", "not-required", undefined]
    ]);
  });

  it("requires actual static declarations and matching method owner, spelling, and file", () => {
    const calls = buildStaticCalls(["static java.util.Collections.emptyList"], [
      staticCall({ receiverType: "java.util.List", location: location(8) }),
      staticCall({ receiverTypeSpelling: "other", location: location(9) }),
      staticCall({ receiverDeclarationFile: "src/demo/Other.java", location: location(10) }),
      staticCall({ target: "java.util.Collections#singletonList(java.lang.Object)", receiverTypeSpelling: "singletonList", location: location(11) })
    ]);
    expect(calls.every(call => call.importId === undefined && call.originKind === "unresolved" && call.originStatus === "unresolved" && call.originEvidence?.reason)).toBe(true);
    const ordinaryImport = buildJavaIndex({ files: [file], summaries: [{ path: file,
      imports: ["java.util.Collections.*"], classReferences: [reference("java.util.Collections", 2, true)], methodCalls: [staticCall()]
    }] }).calls[0];
    expect(ordinaryImport).toMatchObject({ importId: undefined, originKind: "unresolved", originStatus: "unresolved" });
  });

  it("replays every confirmed type-reference finding against the original source spelling and expected import", () => {
    const findings = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../docs/audits/legacy-bank-java8-source-audit-20261105/findings.json"), "utf8"));
    const sites = findings.confirmed.find((finding: { key: string }) => finding.key === "AUD2-IMPORT-02").occurrences;
    expect(sites).toHaveLength(20);
    for (const site of sites) {
      const imports: string[] = [...new Set<string>([site.actualImport, site.expectedImport].filter(Boolean))];
      const index = buildJavaIndex({ files: [site.file], summaries: [{ path: site.file, imports,
        classReferences: [{ symbol: site.sourceSpelling ?? site.source, snippet: site.source,
          qualifiedName: site.target, kind: site.kind, location: site.location }]
      }] });
      const ref = index.classReferences[0];
      expect(ref.importId, `${site.file}:${site.location.line} ${site.source}`).toBe(site.expectedImportId);
      expect(ref.qualifiedName).toBe(site.target);
      expect(ref.location).toEqual(site.location);
    }
  });
});
