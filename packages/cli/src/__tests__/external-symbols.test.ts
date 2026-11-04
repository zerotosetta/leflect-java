import fs from "fs/promises";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExternalSymbolResolver, readExternalSymbolSource, withAnalysisClasspath } from "../external-symbols";

describe("resolved external symbol sources", () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-external-source-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  async function archive(name: string, entries: Record<string, string>) {
    const zip = new AdmZip();
    for (const [entry, text] of Object.entries(entries)) zip.addFile(entry, Buffer.from(text));
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, zip.toBuffer());
    return target;
  }

  it("keeps resolved JDK symbols separate from missing or mismatched source", async () => {
    const sourceArchive = await archive("jdk8/src.zip", {
      "java/util/HashMap.java": "package java.util; public class HashMap {}"
    });
    await fs.writeFile(path.join(root, "jdk8/release"), 'JAVA_VERSION="1.8.0_472"\n');
    const resolve = createExternalSymbolResolver({
      root, analysisOut: path.join(root, "analysis"), java: { targetVersion: "8", sourceArchive }
    });
    const hashMap = await resolve("java.util.HashMap");
    expect(hashMap).toMatchObject({
      symbol: "java.util.HashMap", provider: { name: "jdk", version: "8" },
      source: { status: "available", entry: "java/util/HashMap.java" }
    });
    expect(await readExternalSymbolSource(hashMap)).toMatchObject({
      language: "java", content: "package java.util; public class HashMap {}", truncated: false
    });
    expect(await resolve("java.util.Map")).toMatchObject({ source: { status: "not-found" } });
    const differentVersion = createExternalSymbolResolver({
      root, analysisOut: path.join(root, "analysis"), java: { targetVersion: "17", sourceArchive }
    });
    expect(await differentVersion("java.util.HashMap")).toMatchObject({ source: { status: "version-mismatch" } });
    const withoutSource = createExternalSymbolResolver({ root, analysisOut: "analysis", java: { targetVersion: "8" } });
    expect(await withoutSource("java.util.HashMap")).toMatchObject({
      provider: { name: "jdk", version: "8" }, source: { status: "not-provided" }
    });
  });

  it("matches Servlet sources against the actual classpath provider and version", async () => {
    const binary = await archive("javax.servlet-api-4.0.1.jar", {
      "META-INF/MANIFEST.MF": "Automatic-Module-Name: javax.servlet\nImplementation-Version: 4.0.1\n",
      "javax/servlet/ServletRequest.class": "fixture"
    });
    const sources = await archive("servlet-sources.jar", {
      "javax/servlet/ServletRequest.java": "package javax.servlet; public interface ServletRequest {}"
    });
    const resolve = createExternalSymbolResolver({
      root, analysisOut: "analysis",
      java: { classpath: [binary], librarySources: [{ provider: "javax.servlet", version: "4.0.1", archive: sources }] }
    });
    expect(await resolve("javax.servlet.ServletRequest")).toMatchObject({
      provider: { name: "javax.servlet", version: "4.0.1", path: binary },
      source: { status: "available", entry: "javax/servlet/ServletRequest.java", version: "4.0.1" }
    });
    const mismatch = createExternalSymbolResolver({
      root, analysisOut: "analysis",
      java: { classpath: [binary], librarySources: [{ provider: "javax.servlet", version: "3.1.0", archive: sources }] }
    });
    expect(await mismatch("javax.servlet.ServletRequest")).toMatchObject({ source: { status: "version-mismatch" } });
  });

  it("uses discovered binary providers from the persisted parse environment", async () => {
    const binary = await archive("api-1.2.jar", {
      "META-INF/MANIFEST.MF": "Automatic-Module-Name: demo.library\nImplementation-Version: 1.2\n",
      "api/Functions.class": "fixture"
    });
    const sources = await archive("api-sources.jar", { "api/Functions.java": "package api; public class Functions {}" });
    const analysisOut = path.join(root, "analysis");
    await fs.mkdir(path.join(analysisOut, "manifests"), { recursive: true });
    await fs.writeFile(path.join(analysisOut, "manifests/java-parse.json"), JSON.stringify({ classpathEntries: [binary] }));
    const config = await withAnalysisClasspath({ root, analysisOut, java: {
      librarySources: [{ provider: "demo.library", version: "1.2", archive: sources }]
    } });
    expect(await createExternalSymbolResolver(config)("api.Functions")).toMatchObject({
      provider: { name: "demo.library", version: "1.2", path: binary },
      source: { status: "available", entry: "api/Functions.java" }
    });
  });
});
