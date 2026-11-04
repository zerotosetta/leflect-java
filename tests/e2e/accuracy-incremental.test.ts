import fs from "fs/promises";
import os from "os";
import path from "path";
import { expect, it } from "vitest";
import { analyzeWorkspace } from "@leflect-java/cli";

it("matches a fresh analysis after Java signature changes, deletions, and route/TASK updates", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-accuracy-incremental-"));
  const root = path.join(workspace, "source");
  const incremental = path.join(workspace, "incremental");
  const full = path.join(workspace, "full");
  const emptyFull = path.join(workspace, "empty-full");
  const configPath = path.join(workspace, "leflect.config.json");
  const write = async (file: string, content: string) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  };
  const read = async (out: string, file: string) => JSON.parse(await fs.readFile(path.join(out, file), "utf8"));
  const analyze = (out: string, useIncremental: boolean) => analyzeWorkspace({
    root, configPath, analysisOut: out, incremental: useIncremental, jspAstMode: "lightweight"
  });
  try {
    await fs.writeFile(configPath, JSON.stringify({
      java: { workerJar: path.resolve("java-worker/target/leflectjava-java-worker-0.1.0.jar") },
      jsp: { webappRoot: "web" }
    }));
    await write("src/demo/A.java", 'package demo; public class A { public static Object echo(String value) { return value; } }');
    await write("src/demo/B.java", 'package demo; public class B { public Object use() { return A.echo("value"); } }');
    await write("src/demo/Removed.java", 'package demo; public class Removed { public void doGet() {} }');
    await write("web/WEB-INF/web.xml", '<web-app><servlet><servlet-name>removed</servlet-name><servlet-class>demo.Removed</servlet-class></servlet><servlet-mapping><servlet-name>removed</servlet-name><url-pattern>/before</url-pattern></servlet-mapping></web-app>');
    await write("web/WEB-INF/tasks.tld", '<taglib><uri>urn:demo:wfw</uri><tag><name>task</name><tag-class>demo.TaskTag</tag-class></tag></taglib>');
    await write("web/page.jsp", '<%@ taglib prefix="wfw" uri="urn:demo:wfw" %><wfw:task code="BEFORE_00J"/>');
    await analyze(incremental, false);
    const unchangedCaller = "index/java/src/demo/B.java.json";
    expect((await read(incremental, unchangedCaller)).calls[0].toMethodId).toBe("demo.A#echo(java.lang.String)");

    await write("src/demo/A.java", 'package demo; public class A { public static Object echo(CharSequence value) { return value; } }');
    await fs.unlink(path.join(root, "src/demo/Removed.java"));
    await write("web/WEB-INF/web.xml", '<web-app><servlet><servlet-name>removed</servlet-name><servlet-class>demo.Removed</servlet-class></servlet><servlet-mapping><servlet-name>removed</servlet-name><url-pattern>/after</url-pattern></servlet-mapping></web-app>');
    await write("web/page.jsp", '<%@ taglib prefix="wfw" uri="urn:demo:wfw" %><wfw:task code="AFTER_00J"/>');
    await analyze(incremental, true);
    await analyze(full, false);

    expect((await read(incremental, unchangedCaller)).calls[0].toMethodId).toBe("demo.A#echo(java.lang.CharSequence)");
    expect(await fs.access(path.join(incremental, "index/java/src/demo/Removed.java.json")).then(() => true, () => false)).toBe(false);
    expect((await read(incremental, "index/task-codes.json")).codes).toEqual(["AFTER_00J"]);
    expect((await read(incremental, "index/servlet-entries.json"))[0]).toMatchObject({
      urlPattern: "/after", diagnostic: "Servlet class not found in the project index"
    });
    expect(await semanticSnapshot(incremental)).toEqual(await semanticSnapshot(full));

    await fs.unlink(path.join(root, "src/demo/A.java"));
    await fs.unlink(path.join(root, "src/demo/B.java"));
    await analyze(incremental, true);
    await analyze(emptyFull, false);
    expect(await fs.readFile(path.join(incremental, "index/java-summary.jsonl"), "utf8")).toBe("");
    expect(await read(incremental, "index/java-files.json")).toEqual([]);
    expect(await semanticSnapshot(incremental)).toEqual(await semanticSnapshot(emptyFull));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}, 60_000);

async function semanticSnapshot(base: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.jsonl?$/.test(file)) {
        const raw = await fs.readFile(file, "utf8");
        const parsed = file.endsWith(".jsonl") ? raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(raw);
        result[path.relative(base, file)] = normalize(parsed);
      }
    }
  };
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "generatedAt").map(([key, child]) => [key, normalize(child)]));
    if (typeof value === "string") return value.replaceAll(base, "<OUT>").replaceAll(base.replace(/\\/g, "/"), "<OUT>");
    return value;
  };
  for (const folder of ["index", "graph", "jsp-semantic", "report"]) await walk(path.join(base, folder));
  return result;
}
