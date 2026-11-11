import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSourceResolution } from "../index";
import { resolveJavaWorkerJar } from "../worker-jar";

describe("qualified Java source names", () => {
  let root: string;
  let workerJar: string | undefined;

  beforeAll(async () => { workerJar = await resolveJavaWorkerJar(); });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect qualified source "));
    await fs.mkdir(path.join(root, "first"));
    await fs.mkdir(path.join(root, "second"));
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  async function write(relative: string, text: string) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return file;
  }

  function resolver(javaMap?: Record<string, string>) {
    return createSourceResolution({
      root, analysisOut: path.join(root, "analysis"), java: { workerJar },
      sourceResolution: { javaRoots: ["first", "second", "second/."], javaMap }
    });
  }

  it("resolves the written package-qualified name and checks a real owner for relative member names", async ({ skip }) => {
    if (!workerJar) return skip();
    await write("first/demo/Entry.java", "package demo; public class Entry { demo.Helper helper; Outer.Inner inner; }");
    await write("first/demo/Helper.java", "package demo; public class Helper {}");
    await write("first/demo/demo/Helper.java", "package demo.demo; public class Helper {}");
    await write("first/demo/Outer.java", "package demo; public class Outer { public static class Inner {} }");
    await write("second/demo/Outer/Inner.java", "package demo.Outer; public class Inner {}");

    const result = await resolver().resolveReferences({ targets: [{ targetId: "entry", kind: "java", className: "demo.Entry" }] });
    expect(result.references.find(({ expression }) => expression === "demo.Helper")).toMatchObject({
      status: "resolved", candidates: [{ className: "demo.Helper", path: "demo/Helper.java" }]
    });
    expect(result.references.find(({ expression }) => expression === "Outer.Inner")).toMatchObject({
      status: "resolved", candidates: [{ className: "demo.Outer.Inner", path: "demo/Outer.java" }]
    });
    expect(result.sources.map(({ path }) => path)).not.toContain("demo/demo/Helper.java");
    expect(result.sources.map(({ path }) => path)).not.toContain("demo/Outer/Inner.java");
  }, 15000);

  it("reports distinct top-level and nested declarations with the same qualified name", async ({ skip }) => {
    if (!workerJar) return skip();
    const className = "demo.Outer.Inner";
    await write("first/demo/Outer/Inner.java", "package demo.Outer; public class Inner {}");
    const mappedOwner = await write("second/demo/Outer.java", "package demo; public class Outer { public static class Inner {} }");
    const query = { targets: [{ targetId: "inner", kind: "java" as const, className }] };

    const result = await resolver().resolveReferences(query);
    expect(result.targets).toMatchObject([{
      status: "ambiguous", candidates: [{ path: "demo/Outer/Inner.java" }, { path: "demo/Outer.java" }]
    }]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SOURCE_AMBIGUOUS" })]));

    const mapped = await resolver({ [className]: mappedOwner }).resolveReferences(query);
    expect(mapped.targets).toMatchObject([{ status: "resolved", candidates: [{ path: "demo/Outer.java" }] }]);
  }, 15000);

  it("retains the original search path and checks accessibility through owner types", async ({ skip }) => {
    if (!workerJar) return skip();
    const className = "java.lang.AbstractStringBuilder";
    const privateMember = "PrivateHolder.Parent.Child";
    await write("first/demo/Entry.java", `package demo; public class Entry { ${className} builder; ${privateMember} child; }`);
    await write("second/demo/PrivateHolder.java", `package demo; public class PrivateHolder {
      private static class Parent { protected static class Child {} }
    }`);
    const result = await resolver().resolveReferences({ targets: [
      { targetId: "entry", kind: "java", className: "demo.Entry" },
      { targetId: "missing", kind: "java", className: "app.com.pay.PayService" }
    ] });

    expect(result.references.find(({ expression }) => expression === className)).toMatchObject({
      status: "unsupported", binding: "candidate", candidates: [{ className, rootId: "jdk" }]
    });
    expect(result.references.find(({ expression }) => expression === privateMember)).toMatchObject({
      status: "unsupported", binding: "candidate", candidates: [{ className: `demo.${privateMember}`, path: "demo/PrivateHolder.java" }]
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "JAVA_TYPE_ACCESS", targetId: "entry" }),
      expect.objectContaining({ code: "SOURCE_NOT_FOUND", targetId: "missing", path: "app/com/pay/PayService.java" })
    ]));
  }, 15000);
});
