import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeflectConfig, SourceResolutionConfig } from "@leflect-java/schema";

import { normalizeJspPath, SourceWorkspace, type SourceFile } from "../source-workspace";

describe("source workspace", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect 원문 공백-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function config(sourceResolution: SourceResolutionConfig): LeflectConfig {
    return { root, analysisOut: path.join(root, "analysis"), sourceResolution };
  }

  async function write(relative: string, value: string | Buffer): Promise<string> {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, value);
    return filename;
  }

  const verifyFixture = (source: SourceFile, className: string) =>
    source.text.includes(`package ${className.slice(0, className.lastIndexOf("."))};`) &&
    source.text.includes(`class ${className.split(".").at(-1)} {`);

  it("resolves JSP web paths and Java source roots without duplicating path segments", async () => {
    const jsp = "<% new PayService(); %>\r\n한글";
    const jspPath = await write("mobweb/comm/x.jsp", jsp);
    await write("class_src_service/src/app/com/pay/service/PayService.java", "package app.com.pay.service; class PayService {}");
    await write("class_src_wbf/src/app/wbf/Helper.java", "package app.wbf; class Helper {}");
    const workspace = new SourceWorkspace(config({
      webRoot: ".", javaRoots: ["class_src_service/src/", "class_src_wbf/src"]
    }));
    const session = workspace.start();
    const found = await session.resolveJsp("/mobweb/comm/x.jsp");
    expect(found.status).toBe("resolved");
    expect(found.candidates[0]).toMatchObject({ rootId: "web", path: "mobweb/comm/x.jsp", sourceHash: hash(Buffer.from(jsp)) });
    expect(session.sources.get(found.candidates[0].sourceId!)?.text).toBe(jsp);
    expect(await session.resolveJava("app.com.pay.service.PayService", verifyFixture)).toMatchObject({
      status: "resolved", candidates: [{ rootId: "java-1", path: "app/com/pay/service/PayService.java" }]
    });
    expect(await session.resolveJava("app.wbf.Helper", verifyFixture)).toMatchObject({
      status: "resolved", candidates: [{ rootId: "java-2", path: "app/wbf/Helper.java" }]
    });
    const wrongWebRoot = new SourceWorkspace(config({ webRoot: "mobweb" })).start();
    expect(await wrongWebRoot.resolveJsp("/mobweb/comm/x.jsp")).toMatchObject({
      status: "missing", complete: true, diagnostics: [{ code: "SOURCE_NOT_FOUND", path: "mobweb/comm/x.jsp" }]
    });
    const mapped = new SourceWorkspace(config({ webRoot: "mobweb", sourceMap: { "/legacy.jsp": jspPath } })).start();
    expect(await mapped.resolveJsp("/legacy.jsp")).toMatchObject({
      status: "resolved", candidates: [{ logicalPath: "/legacy.jsp", path: "comm/x.jsp" }]
    });
  });

  it("retains distinct declarations and marks incomplete root probes", async () => {
    const first = await write("first/app/Service.java", "package app; class Service {}");
    await write("second/app/Service.java", "package app; class Service { int id; }");
    const duplicate = new SourceWorkspace(config({ javaRoots: ["first", "second"] })).start();
    expect(await duplicate.resolveJava("app.Service", verifyFixture)).toMatchObject({
      status: "ambiguous", candidates: [{ rootId: "java-1" }, { rootId: "java-2" }]
    });
    const incomplete = new SourceWorkspace(config({ javaRoots: ["missing", "second"] })).start();
    expect(await incomplete.resolveJava("app.Service", verifyFixture)).toMatchObject({
      status: "blocked", complete: false, candidates: [{ rootId: "java-2" }],
      diagnostics: [{ code: "SOURCE_ROOT_UNAVAILABLE", rootId: "java-1" }]
    });
    expect(incomplete.probes).toBe(2);
    expect(await incomplete.getRootDiagnostics()).toContainEqual(expect.objectContaining({
      code: "SOURCE_ROOT_UNAVAILABLE", path: "missing", rootId: "java-1"
    }));

    const mapped = new SourceWorkspace(config({ javaRoots: ["first", "second"], javaMap: { "app.Service": first } })).start();
    expect(await mapped.resolveJava("app.Service", verifyFixture)).toMatchObject({
      status: "resolved", candidates: [{ rootId: "java-1" }]
    });
    const limited = new SourceWorkspace(config({ javaRoots: ["first", "second"], limits: { maxProbes: 1 } })).start();
    expect(await limited.resolveJava("app.Service", verifyFixture)).toMatchObject({
      status: "limit", complete: false, candidates: [{ rootId: "java-1" }]
    });
  });

  it("keeps one copy of aliased files and blocks an escaping junction", async () => {
    await write("original/app/Service.java", "package app; class Service {}");
    await write("outside/escape.jsp", "<% new Secret(); %>");
    await fs.mkdir(path.join(root, "web"));
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(path.join(root, "outside"), path.join(root, "web", "external"), linkType);
    await fs.symlink(path.join(root, "original"), path.join(root, "alias"), linkType);

    const session = new SourceWorkspace(config({ webRoot: "web", javaRoots: ["alias", "original"] })).start();
    expect(await session.resolveJsp("/external/escape.jsp")).toMatchObject({
      status: "blocked", candidates: [], diagnostics: [{ code: "SOURCE_BOUNDARY" }]
    });
    expect(await session.resolveJsp("/external/missing.jsp")).toMatchObject({
      status: "blocked", candidates: [], diagnostics: [{ code: "SOURCE_BOUNDARY" }]
    });
    expect(await session.resolveJava("app.Service", verifyFixture)).toMatchObject({
      status: "resolved", candidates: [{ rootId: "java-1" }]
    });
    expect(session.sources.size).toBe(1);
    expect(normalizeJspPath("../shared/head.jsp", "/web/parts/body.jsp")).toBe("/web/shared/head.jsp");
    expect(normalizeJspPath("../../secret.jsp", "/body.jsp")).toBeUndefined();
    expect(normalizeJspPath("C:\\outside\\secret.jsp")).toBeUndefined();
  });

  it("reports byte decoding failures and hashes the original bytes with file overrides", async () => {
    const bytes = Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]);
    await write("web/a.jsp", bytes);
    await write("web/b.jsp", bytes);
    const session = new SourceWorkspace(config({ webRoot: "web", encodingOverrides: { "web/b.jsp": "euc-kr" } })).start();
    expect(await session.resolveJsp("/a.jsp")).toMatchObject({
      status: "blocked", diagnostics: [{ code: "SOURCE_ENCODING" }], candidates: []
    });
    const result = await session.resolveJsp("/b.jsp");
    expect(result.status).toBe("resolved");
    expect(session.sources.get(result.candidates[0].sourceId!)).toMatchObject({
      text: "안녕", encoding: "euc-kr", sourceHash: hash(bytes), bytes
    });
  });

  it("identifies configured binary classes and checks classpath snapshot versions before analysis", async () => {
    const knownJar = path.resolve(__dirname, "../../../../resources/api-packs/javax.servlet-api/4.0.1/javax.servlet-api-4.0.1.jar");
    const jar = await write("lib/servlet.jar", await fs.readFile(knownJar));
    const session = new SourceWorkspace({ ...config({ javaRoots: [] }), java: { classpath: [jar] } }).start();
    expect(await session.resolveJava("javax.servlet.Servlet", verifyFixture)).toMatchObject({
      status: "binary_only", complete: true, candidates: [{ rootId: "classpath-1", path: "servlet.jar!/javax/servlet/Servlet.class" }]
    });
    const classpath = await session.pinClasspath();
    const entries = await classpath.materialize(path.join(root, "fixed"));
    expect(await fs.readFile(entries[0])).toEqual(await fs.readFile(knownJar));
    await fs.appendFile(jar, "edited");
    await expect(classpath.materialize(path.join(root, "fixed again"))).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
});

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
