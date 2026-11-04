import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import AdmZip from "adm-zip";

import { parseJsp } from "@leflect-java/parser-jsp";
import { loadTldRegistry, parseTld } from "@leflect-java/parser-tld";
import { afterEach, describe, expect, it } from "vitest";

import { resolveJspFunctions } from "../jsp-functions";

describe("TLD EL function links", () => {
  const roots: string[] = [];
  afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

  it("resolves aliases at exact locations and preserves failed signature verification", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-el-function-"));
    roots.push(root);
    const file = "page.tag";
    const text = '<%@ taglib prefix="app" uri="urn:test" %>\n<input value="\${app:alias(request)} \${app:wrong(request)}">';
    await fs.writeFile(path.join(root, file), text);
    const parsed = parseJsp(text, { sourceKind: "tag" });
    const registry = parseTld("<taglib><uri>urn:test</uri><function><name>alias</name><function-class>demo.Web</function-class><function-signature>java.lang.String csrf(javax.servlet.http.HttpServletRequest)</function-signature></function><function><name>wrong</name><function-class>demo.Web</function-class><function-signature>java.lang.String hidden(javax.servlet.http.HttpServletRequest)</function-signature></function></taglib>");
    expect(registry.functions).toHaveLength(2);
    const index = {
      classes: [
        { id: "demo.Web", name: "Web", packageName: "demo", file: "Web.java" },
        { id: "javax.servlet.http.HttpServletRequest", name: "HttpServletRequest", packageName: "javax.servlet.http", file: "HttpServletRequest.java" }
      ],
      methods: [
        { id: "demo.Web#csrf(HttpServletRequest)", classId: "demo.Web", file: "Web.java", name: "csrf", returnType: "String", parameters: ["HttpServletRequest"], modifiers: ["public", "static"] },
        { id: "demo.Web#hidden(HttpServletRequest)", classId: "demo.Web", file: "Web.java", name: "hidden", returnType: "String", parameters: ["HttpServletRequest"], modifiers: ["private", "static"] }
      ],
      imports: [{ id: "import", file: "Web.java", import: "javax.servlet.http.*" }]
    };
    const refs = (await resolveJspFunctions({ root }, [{ path: file, ...parsed }], [{ ...registry, sourcePath: "bank.tld" }], index)).get(file)!;
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      name: "alias", methodName: "csrf", methodId: "demo.Web#csrf(javax.servlet.http.HttpServletRequest)",
      validation: "source", targetFile: "Web.java", location: { line: 2, column: 17 }
    });
    expect(refs[1]).toMatchObject({ validation: "unresolved", unresolvedReason: expect.stringContaining("public static") });
  });

  it("validates external signatures and rejects wrong declared return types", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-el-external-"));
    roots.push(root);
    const text = '<%@ taglib prefix="app" uri="urn:test" %>\${app:valid(x)} \${app:invalid(x)}';
    await fs.writeFile(path.join(root, "page.jsp"), text);
    const parsed = parseJsp(text);
    const registry = parseTld("<taglib><uri>urn:test</uri><function><name>valid</name><function-class>java.lang.String</function-class><function-signature>java.lang.String valueOf(java.lang.Object)</function-signature></function><function><name>invalid</name><function-class>java.lang.String</function-class><function-signature>boolean valueOf(java.lang.Object)</function-signature></function></taglib>");
    const refs = (await resolveJspFunctions({ root }, [{ path: "page.jsp", ...parsed }], [registry], { classes: [], methods: [], imports: [] })).get("page.jsp")!;
    expect(refs[0]).toMatchObject({ validation: "classpath", methodId: "java.lang.String#valueOf(java.lang.Object)" });
    expect(refs[1].validation).toBe("unresolved");
  });

  it("uses the configured classpath for overloaded methods and rejects nonstatic targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-el-classpath-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "external"));
    await fs.writeFile(path.join(root, "external/Functions.java"), [
      "package external; public class Functions {",
      " public static String label(Object value) { return \"object\"; }",
      " public static String label(String value) { return \"string\"; }",
      " public String instance(Object value) { return \"instance\"; }",
      "}"
    ].join("\n"));
    await promisify(execFile)("javac", ["-d", root, path.join(root, "external/Functions.java")]);
    const text = '<%@ taglib prefix="app" uri="urn:test" %>${app:label(x)} ${app:instance(x)}';
    await fs.writeFile(path.join(root, "page.jsp"), text);
    const parsed = parseJsp(text);
    const registry = parseTld('<taglib><uri>urn:test</uri><function><name>label</name><function-class>external.Functions</function-class><function-signature>java.lang.String label(java.lang.Object)</function-signature></function><function><name>instance</name><function-class>external.Functions</function-class><function-signature>java.lang.String instance(java.lang.Object)</function-signature></function></taglib>');
    const docs = [{ path: "page.jsp", ...parsed }];
    const index = { classes: [], methods: [], imports: [] };
    const configured = (await resolveJspFunctions({ root, java: { classpath: [root] } }, docs, [registry], index)).get("page.jsp")!;
    expect(configured[0]).toMatchObject({ validation: "classpath", methodId: "external.Functions#label(java.lang.Object)", parameterTypes: ["java.lang.Object"] });
    expect(configured[1]).toMatchObject({ validation: "unresolved", unresolvedReason: expect.stringContaining("public static") });
    const missing = (await resolveJspFunctions({ root }, docs, [registry], index)).get("page.jsp")!;
    expect(missing[0]).toMatchObject({ validation: "unresolved", unresolvedReason: expect.stringContaining("configured Java classpath") });
  });

  it("does not resolve a wildcard type over a same-package declaration or ambiguous wildcard imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-el-type-scope-"));
    roots.push(root);
    const text = '<%@ taglib prefix="app" uri="urn:test" %>${app:date(x)} ${app:ambiguous(x)}';
    await fs.writeFile(path.join(root, "page.jsp"), text);
    const parsed = parseJsp(text);
    const registry = parseTld('<taglib><uri>urn:test</uri><function><name>date</name><function-class>demo.Web</function-class><function-signature>java.lang.String date(java.util.Date)</function-signature></function><function><name>ambiguous</name><function-class>demo.Other</function-class><function-signature>java.lang.String pick(first.Token)</function-signature></function></taglib>');
    const index = {
      classes: [
        { id: "demo.Web", name: "Web", packageName: "demo", file: "Web.java" },
        { id: "demo.Date", name: "Date", packageName: "demo", file: "Date.java" },
        { id: "demo.Other", name: "Other", packageName: "demo", file: "Other.java" },
        { id: "first.Token", name: "Token", packageName: "first", file: "First.java" },
        { id: "second.Token", name: "Token", packageName: "second", file: "Second.java" }
      ],
      methods: [
        { id: "demo.Web#date(Date)", classId: "demo.Web", file: "Web.java", name: "date", returnType: "String", parameters: ["Date"], modifiers: ["public", "static"] },
        { id: "demo.Other#pick(Token)", classId: "demo.Other", file: "Other.java", name: "pick", returnType: "String", parameters: ["Token"], modifiers: ["public", "static"] }
      ],
      imports: [
        { id: "date", file: "Web.java", import: "java.util.*" },
        { id: "first", file: "Other.java", import: "first.*" },
        { id: "second", file: "Other.java", import: "second.*" }
      ]
    };
    const refs = (await resolveJspFunctions({ root }, [{ path: "page.jsp", ...parsed }], [registry], index)).get("page.jsp")!;
    expect(refs[0].validation).toBe("unresolved");
    expect(refs[0].unresolvedReason).toContain("demo.Date");
    expect(refs[1].validation).toBe("unresolved");
    expect(refs[1].unresolvedReason).toContain("Ambiguous");
  });

  it("keeps alias-bound standard function occurrences and resolves their local classpath TLD when enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-standard-function-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "external"));
    const javaSource = path.join(root, "external/Functions.java");
    await fs.writeFile(javaSource, [
      "package external; public class Functions {",
      " public static int length(Object value) { return 0; }",
      " public static String escapeXml(String value) { return value; }",
      " public static String[] split(String value, String delimiter) { return new String[] {value}; }",
      "}"
    ].join("\n"));
    await promisify(execFile)("javac", ["-d", root, javaSource]);
    const uri = "http://java.sun.com/jsp/jstl/functions";
    const tld = '<taglib><uri>' + uri + '</uri>' + [
      '<function><name>length</name><function-class>external.Functions</function-class><function-signature>int length(java.lang.Object)</function-signature></function>',
      '<function><name>escapeXml</name><function-class>external.Functions</function-class><function-signature>java.lang.String escapeXml(java.lang.String)</function-signature></function>',
      '<function><name>split</name><function-class>external.Functions</function-class><function-signature>java.lang.String[] split(java.lang.String,java.lang.String)</function-signature></function>'
    ].join("") + '</taglib>';
    const jar = new AdmZip();
    jar.addFile("external/Functions.class", await fs.readFile(path.join(root, "external/Functions.class")));
    jar.addFile("META-INF/fn.tld", Buffer.from(tld));
    const archive = path.join(root, "functions.jar");
    await fs.writeFile(archive, jar.toBuffer());
    const text = `<%@ taglib prefix="lib" uri="${uri}" %>\n${'${lib:length(items)} ${lib:escapeXml(value)} ${lib:split(value, delimiter)}'}`;
    await fs.writeFile(path.join(root, "page.jsp"), text);
    const docs = [{ path: "page.jsp", ...parseJsp(text) }];
    const index = { classes: [], methods: [], imports: [] };
    const disabled = await loadTldRegistry({ root, classpathEntries: [archive], autoLoad: false });
    const excluded = (await resolveJspFunctions({ root, jsp: { tld: { autoLoad: false } } }, docs, disabled.entries, index)).get("page.jsp")!;
    expect(excluded).toHaveLength(3);
    expect(excluded.every(reference => reference.validation === "excluded" && reference.excludedReason?.includes("disabled"))).toBe(true);
    expect(excluded.map(reference => reference.location.column)).toEqual([3, 24, 48]);

    const loaded = await loadTldRegistry({ root, classpathEntries: [archive], autoLoad: true });
    const configured = (await resolveJspFunctions({ root, java: { classpath: [archive] }, jsp: { tld: { autoLoad: true } } }, docs, loaded.entries, index)).get("page.jsp")!;
    expect(configured.every(reference => reference.validation === "classpath")).toBe(true);
    expect(configured.map(reference => reference.methodId)).toEqual([
      "external.Functions#length(java.lang.Object)",
      "external.Functions#escapeXml(java.lang.String)",
      "external.Functions#split(java.lang.String,java.lang.String)"
    ]);
    expect(configured.every(reference => reference.declarationPath === archive.replace(/\\/g, "/") + "!/META-INF/fn.tld" && reference.declarationLineRange)).toBe(true);
    const missingTld = (await resolveJspFunctions({ root, jsp: { tld: { autoLoad: true } } }, docs, [], index)).get("page.jsp")!;
    expect(missingTld.every(reference => reference.validation === "unresolved" && reference.unresolvedReason?.includes("No TLD registered"))).toBe(true);
    const missingConfiguredTld = (await resolveJspFunctions({ root, jsp: { tld: { paths: ["missing-fn.tld"] } } }, docs, [], index)).get("page.jsp")!;
    expect(missingConfiguredTld.every(reference => reference.validation === "unresolved" && reference.unresolvedReason?.includes("No TLD registered"))).toBe(true);
    const missingMappedTld = (await resolveJspFunctions({ root, jsp: { tld: { uriMap: { [uri]: "missing-fn.tld" } } } }, docs, [], index)).get("page.jsp")!;
    expect(missingMappedTld.every(reference => reference.validation === "unresolved" && reference.unresolvedReason?.includes("No TLD registered"))).toBe(true);
    const missingBinary = (await resolveJspFunctions({ root, jsp: { tld: { autoLoad: true } } }, docs, loaded.entries, index)).get("page.jsp")!;
    expect(missingBinary.every(reference => reference.validation === "unresolved" && reference.unresolvedReason?.includes("configured Java classpath"))).toBe(true);
  }, 30_000);
});
