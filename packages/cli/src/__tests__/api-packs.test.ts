import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeflectConfig } from "@leflect-java/schema";
import { createApiPackCacheInput, resolveApiPackClasspath } from "../api-packs";
import { createExternalSymbolResolver, withAnalysisClasspath } from "../external-symbols";

describe("project-first API reference packs", () => {
  let root: string;
  let config: LeflectConfig;
  const bundled = path.resolve(__dirname, "../../../../resources/api-packs");
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-api-pack-"));
    config = { root, analysisOut: path.join(root, "analysis"),
      java: { apiPacks: { mode: "fallback", directory: bundled } } };
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  async function pom(version = "4.0.1", extra = "") {
    await fs.writeFile(path.join(root, "pom.xml"), `<project><dependencies><dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>${version}</version><scope>provided</scope></dependency>${extra}</dependencies></project>`);
  }
  async function environment() {
    return JSON.parse(await fs.readFile(path.join(config.analysisOut, "manifests/api-packs-java.json"), "utf8"));
  }
  async function editablePack() {
    const target = path.join(root, "pack");
    await fs.cp(bundled, target, { recursive: true });
    config.java!.apiPacks!.directory = target;
    return { target, manifest: JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8")) };
  }

  it("defaults to off and requires an exact project declaration", async () => {
    await pom();
    delete config.java!.apiPacks;
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
    expect(await environment()).toMatchObject({ mode: "off", decisions: [] });
    config.java!.apiPacks = { mode: "fallback", directory: bundled };
    await fs.unlink(path.join(root, "pom.xml"));
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
  });

  it("selects exact provided APIs and attaches their actual provider's matching sources", async () => {
    await pom("4.0.1", "<dependency><groupId>javax.servlet.jsp</groupId><artifactId>javax.servlet.jsp-api</artifactId><version>2.3.3</version><scope>provided</scope></dependency>");
    const classpathEntries = await resolveApiPackClasspath(config, [], "java");
    expect(classpathEntries).toHaveLength(2);
    const env = await environment();
    expect(env.diagnostics).toEqual([]);
    expect(env.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ selection: "pack", coordinate: "javax.servlet:javax.servlet-api:4.0.1", sources: expect.any(String), provider: expect.objectContaining({ name: "javax.servlet-api", version: "4.0.1" }) }),
      expect.objectContaining({ selection: "pack", coordinate: "javax.servlet.jsp:javax.servlet.jsp-api:2.3.3", sources: expect.any(String) })
    ]));
    await fs.writeFile(path.join(config.analysisOut, "manifests/java-parse.json"), JSON.stringify({ classpathEntries }));
    const analyzed = await withAnalysisClasspath(config);
    const resolve = createExternalSymbolResolver(analyzed);
    expect(await resolve("javax.servlet.http.HttpServlet")).toMatchObject({
      provider: { name: "javax.servlet-api", version: "4.0.1" },
      source: { status: "available", version: "4.0.1", entry: "javax/servlet/http/HttpServlet.java" }
    });
    expect(await resolve("javax.servlet.jsp.JspPage")).toMatchObject({ source: { status: "available", version: "2.3.3" } });
  });

  it("keeps explicit older project API authoritative and reports version conflict", async () => {
    await pom();
    const zip = new AdmZip();
    zip.addFile("META-INF/MANIFEST.MF", Buffer.from("Bundle-SymbolicName: old.servlet\nImplementation-Version: 3.1.0\n"));
    zip.addFile("javax/servlet/http/HttpServlet.class", Buffer.from("fixture"));
    const projectApi = path.join(root, "old-api.jar");
    await fs.writeFile(projectApi, zip.toBuffer());
    expect(await resolveApiPackClasspath(config, [projectApi], "java")).toEqual([projectApi]);
    expect(await environment()).toMatchObject({
      decisions: [{ selection: "project", provider: { name: "old.servlet", version: "3.1.0", path: projectApi } }],
      diagnostics: [{ code: "project-version-conflict" }]
    });
  });

  it("does not confuse JSP namespace content with the core Servlet API", async () => {
    await pom();
    const jspOnly = path.join(bundled, "javax.servlet.jsp-api/2.3.3/javax.servlet.jsp-api-2.3.3.jar");
    const entries = await resolveApiPackClasspath(config, [jspOnly], "java");
    expect(entries).toHaveLength(2);
    expect((await environment()).decisions[0].selection).toBe("pack");
  });

  it("does not confuse the JSTL sub-API with the core JSP API", async () => {
    await pom("4.0.1", "<dependency><groupId>javax.servlet.jsp</groupId><artifactId>javax.servlet.jsp-api</artifactId><version>2.3.3</version></dependency>");
    const zip = new AdmZip();
    zip.addFile("javax/servlet/jsp/jstl/core/Config.class", Buffer.from("fixture"));
    const jstl = path.join(root, "jstl-spec.jar");
    await fs.writeFile(jstl, zip.toBuffer());
    expect(await resolveApiPackClasspath(config, [jstl], "java")).toHaveLength(3);
    expect((await environment()).decisions.map((decision: { selection: string }) => decision.selection)).toEqual(["pack", "pack"]);
    expect((await environment()).diagnostics).toEqual([]);
  });

  it("reuses sources for a byte-identical project artifact without injecting a pack binary", async () => {
    await pom();
    const projectApi = path.join(root, "javax.servlet-api-4.0.1.jar");
    await fs.copyFile(path.join(bundled, "javax.servlet-api/4.0.1/javax.servlet-api-4.0.1.jar"), projectApi);
    config.java!.classpath = [projectApi];
    expect(await resolveApiPackClasspath(config, [projectApi], "java")).toEqual([projectApi]);
    expect((await environment()).decisions[0]).toMatchObject({ selection: "project", binary: projectApi, sources: expect.any(String) });
    expect(await createExternalSymbolResolver(await withAnalysisClasspath(config))("javax.servlet.http.HttpServlet"))
      .toMatchObject({ provider: { path: projectApi, version: "4.0.1" }, source: { status: "available", version: "4.0.1" } });
  });

  it("supports namespace-qualified POM properties and local managed versions", async () => {
    await fs.writeFile(path.join(root, "pom.xml"), `<m:project xmlns:m="http://maven.apache.org/POM/4.0.0"><m:properties><api.version>4.0.1</api.version></m:properties><m:dependencyManagement><m:dependencies><m:dependency><m:groupId>javax.servlet</m:groupId><m:artifactId>javax.servlet-api</m:artifactId><m:version>\${api.version}</m:version></m:dependency></m:dependencies></m:dependencyManagement><m:dependencies><m:dependency><m:groupId>javax.servlet</m:groupId><m:artifactId>javax.servlet-api</m:artifactId></m:dependency></m:dependencies></m:project>`);
    expect(await resolveApiPackClasspath(config, [], "java")).toHaveLength(1);
  });

  it.each(["inherited-dependency", "inherited-management"])("interpolates %s with child property overrides", async kind => {
    const parent = path.join(root, "parent"), child = path.join(root, "child");
    await fs.mkdir(parent); await fs.mkdir(child);
    const dependency = `<dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>\${api.version}</version><scope>provided</scope></dependency>`;
    await fs.writeFile(path.join(parent, "pom.xml"), `<project><groupId>test</groupId><artifactId>parent</artifactId><version>1</version><properties><api.version>4.0.1</api.version></properties>${kind === "inherited-management" ? `<dependencyManagement><dependencies>${dependency}</dependencies></dependencyManagement>` : `<dependencies>${dependency}</dependencies>`}</project>`);
    const writeChild = (version: string) => fs.writeFile(path.join(child, "pom.xml"), `<project><parent><groupId>test</groupId><artifactId>parent</artifactId><version>1</version><relativePath>../parent/pom.xml</relativePath></parent><artifactId>child</artifactId><properties><api.version>${version}</api.version></properties>${kind === "inherited-management" ? `<dependencies><dependency><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId></dependency></dependencies>` : ""}</project>`);
    config.root = child;
    await writeChild("3.1.0");
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
    expect((await environment()).decisions[0]).toMatchObject({ coordinate: "javax.servlet:javax.servlet-api:3.1.0", selection: "unavailable" });
    await writeChild("4.0.1");
    expect(await resolveApiPackClasspath(config, [], "java")).toHaveLength(1);
    expect((await environment()).decisions[0]).toMatchObject({ coordinate: "javax.servlet:javax.servlet-api:4.0.1", selection: "pack" });
  });

  it.each(["[3.0,5.0)", "${unresolved.version}", "", "LATEST", "3.1.0"])("does not invent a match for version %s", async version => {
    await pom(version);
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
    expect((await environment()).diagnostics[0].code).toMatch(/unsupported-version|version-not-exact/);
  });

  it("records namespace mismatch without translating Jakarta to javax", async () => {
    await fs.writeFile(path.join(root, "pom.xml"), "<project><dependencies><dependency><groupId>jakarta.servlet</groupId><artifactId>jakarta.servlet-api</artifactId><version>6.0.0</version></dependency></dependencies></project>");
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
    expect((await environment()).diagnostics[0]).toMatchObject({ code: "unsupported-coordinate", coordinate: "jakarta.servlet:jakarta.servlet-api:6.0.0" });
  });

  it("invalidates cache on binary/source changes and keeps missing sources independent of binary resolution", async () => {
    await pom();
    const { target, manifest } = await editablePack();
    const before = await createApiPackCacheInput(config);
    await fs.unlink(path.join(target, manifest.components[0].sources.path));
    expect(await createApiPackCacheInput(config)).not.toEqual(before);
    expect(await resolveApiPackClasspath(config, [], "java")).toHaveLength(1);
    expect(await environment()).toMatchObject({ diagnostics: [{ code: "source-unavailable" }] });
    await fs.appendFile(path.join(target, manifest.components[0].binary.path), "tampered");
    expect(await resolveApiPackClasspath(config, [], "java")).toEqual([]);
    expect(await environment()).toMatchObject({ diagnostics: [{ code: "pack-integrity-failed" }] });
  });

  it("rejects an independently checksummed source archive with a different API coordinate", async () => {
    await pom();
    const { target, manifest } = await editablePack();
    const component = manifest.components[0];
    const file = path.join(target, component.sources.path);
    const zip = new AdmZip(await fs.readFile(file));
    zip.updateFile("pom.xml", Buffer.from("<project><groupId>javax.servlet</groupId><artifactId>javax.servlet-api</artifactId><version>3.1.0</version></project>"));
    const bytes = zip.toBuffer();
    await fs.writeFile(file, bytes);
    component.sources.sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest));
    expect(await resolveApiPackClasspath(config, [], "java")).toHaveLength(1);
    expect(await environment()).toMatchObject({ diagnostics: [{ code: "source-version-mismatch" }] });
  });
});
