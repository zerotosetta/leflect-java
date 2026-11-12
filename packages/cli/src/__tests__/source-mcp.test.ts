import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveJavaWorkerJar } from "../worker-jar";

type TestLogRecord = {
  schemaVersion: number;
  time: string;
  event: string;
  sessionId: string;
  requestId?: number;
  direction?: "in" | "out";
  method?: string;
  tool?: string;
  worker?: string;
  stream?: string;
  bytes?: number;
  detail?: string;
  payload?: string;
};

type RpcResult = {
  tools?: { name: string; inputSchema: object; outputSchema: object }[];
  isError?: boolean;
  content?: [{ type: string; text: string }];
  structuredContent?: Payload;
};
type Payload = {
  schemaVersion: number;
  status: string;
  nextCursor: string | null;
  snapshotId: string;
  diagnostics: { code: string }[];
  sources?: { sourceId: string; path: string; sourceHash: string }[];
  source?: { sourceId: string; path: string; sourceHash: string };
  targets?: { targetId: string; status: string; sourceId?: string }[];
  references?: { expression: string; location: { path: string; line: number } }[];
  results?: { kind: string; location: { path: string; line: number }; detail: { targetMethodName?: string } }[];
  unprocessedTargetIds?: string[];
  data?: string;
  offset?: number;
  length?: number;
  fragments?: { section: "references" | "targets" | "sources" | "results" | "diagnostics"; index: number; offset: number; data: string; last: boolean }[];
};

const jar = resolveJavaWorkerJar();
const installedCli = process.env.LEFLECT_TEST_MCP_ENTRY;
const cli = installedCli ?? path.resolve(__dirname, "../../../../bin/leflect");
const maxResponseBytes = 2700;

describe("source MCP over stdio", () => {
  let root: string;
  let stop: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect 작업 폴더 "));
  });

  afterEach(async () => {
    await stop?.();
    stop = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  async function start(timeoutMs = 12000, logging?: { path: string; includePayloads?: boolean }, javaToolOptions?: string) {
    const worker = installedCli ? undefined : await jar;
    if (!installedCli && !worker) throw new Error("Build the Java worker before running source MCP tests.");
    const config = path.join(root, "설정 파일.json");
    await fs.writeFile(config, JSON.stringify({
      root: ".", java: { workerJar: worker },
      sourceResolution: { webRoot: ".", javaRoots: ["java 소스"], limits: { maxResponseBytes, timeoutMs }, logging }
    }));
    const child = spawn(process.execPath, [cli, "mcp", "--config", config], {
      cwd: root, stdio: "pipe", windowsHide: true,
      env: javaToolOptions ? { ...process.env, JAVA_TOOL_OPTIONS: javaToolOptions } : process.env
    });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    stop = async () => {
      child.stdin.end();
      await closed;
    };
    let id = 0;
    const pending = new Map<number, { resolve: (value: { result: RpcResult; bytes: number }) => void; reject: (error: Error) => void }>();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const reply = JSON.parse(line) as { id: number; result: RpcResult; error?: { message: string } };
      if (reply.error) pending.get(reply.id)?.reject(new Error(reply.error.message));
      else pending.get(reply.id)?.resolve({ result: reply.result, bytes: Buffer.byteLength(line + "\n") });
      pending.delete(reply.id);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    void closed.then(() => {
      for (const waiting of pending.values()) waiting.reject(new Error("MCP closed."));
      pending.clear();
    });
    const rpc = (method: string, params?: object) => {
      const requestId = ++id;
      return new Promise<{ result: RpcResult; bytes: number }>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
      });
    };
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "vitest", version: "1" } });
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const call = async (name: string, args: object) => {
      const { result, bytes } = await rpc("tools/call", { name, arguments: args });
      expect(bytes).toBeLessThanOrEqual(maxResponseBytes);
      const payload = JSON.parse(result.content![0].text) as Payload;
      expect(payload.schemaVersion).toBe(1);
      if (!result.isError) expect(payload).toEqual(result.structuredContent);
      return payload;
    };
    const pages = async (name: string, args: object) => {
      const payloads = [await call(name, args)];
      while (payloads.at(-1)!.nextCursor) {
        expect(payloads.length).toBeLessThan(100);
        payloads.push(await call(name, { cursor: payloads.at(-1)!.nextCursor }));
      }
      expect(payloads.at(-1)!.nextCursor).toBeNull();
      const fragments = new Map<string, string>();
      for (const payload of payloads) {
        for (const fragment of payload.fragments ?? []) {
          const key = fragment.section + fragment.index;
          const previous = fragments.get(key) ?? "";
          expect(fragment.offset).toBe(previous.length);
          const text = previous + fragment.data;
          if (fragment.last) {
            (payload[fragment.section] ??= []).push(JSON.parse(text));
            fragments.delete(key);
          } else fragments.set(key, text);
        }
      }
      expect(fragments.size).toBe(0);
      return payloads;
    };
    return { rpc, call, pages, stderr: () => stderr };
  }

  async function readLogs(relativePath: string): Promise<{ text: string; records: TestLogRecord[] }> {
    const text = await fs.readFile(path.join(root, relativePath), "utf8");
    return { text, records: text.trimEnd().split("\n").map((line) => JSON.parse(line) as TestLogRecord) };
  }

  it("appends exact MCP frames and lifecycle events to a configured Unicode log path", async () => {
    const pagePath = "화면.jsp";
    const logPath = "진단 폴더/입출력.jsonl";
    const original = '원문 payload 🎉 <% String label = "test"; %>';
    await fs.writeFile(path.join(root, pagePath), original);
    await fs.mkdir(path.join(root, "java 소스"));
    const client = await start(12000, { path: logPath, includePayloads: true }, "-Dleflect.log.test=system-details");
    const resolved = await client.call("resolve_references", { targets: [{ targetId: "page", kind: "jsp", path: "/" + pagePath }] });
    const sourceId = resolved.sources![0].sourceId;
    const reply = await client.call("get_source", { snapshotId: resolved.snapshotId, sourceId, format: "text" });
    expect(reply.data).toBe(original);
    await client.call("get_source", { snapshotId: "expired", sourceId, format: "text" });
    await stop?.();

    const { records, text } = await readLogs(logPath);
    expect(records[0]).toMatchObject({ event: "server.start", schemaVersion: 1, transport: "stdio" });
    expect(records.at(-1)).toMatchObject({ event: "server.stop" });
    expect(records.every(({ time, sessionId }) => !Number.isNaN(Date.parse(time)) && sessionId === records[0].sessionId)).toBe(true);
    const input = records.find(({ event, direction, tool }) => event === "rpc" && direction === "in" && tool === "get_source")!;
    const output = records.find(({ event, direction, requestId }) => event === "rpc" && direction === "out" && requestId === input.requestId)!;
    expect(input.bytes).toBe(Buffer.byteLength(input.payload!));
    expect(JSON.parse(input.payload!)).toMatchObject({ id: input.requestId, params: { name: "get_source", arguments: { sourceId } } });
    expect(JSON.parse(output.payload!)).toMatchObject({ id: input.requestId, result: { structuredContent: { data: original } } });
    expect(records).toContainEqual(expect.objectContaining({
      event: "tool.error", code: "SNAPSHOT_EXPIRED", tool: "get_source", level: "error"
    }));
    expect(records).toContainEqual(expect.objectContaining({
      event: "worker.output", worker: "source-syntax", stream: "stderr", detail: expect.stringContaining("system-details")
    }));
    expect(client.stderr()).toBe("");

    await fs.writeFile(path.join(root, logPath), text.trimEnd());
    await start(12000, { path: logPath, includePayloads: true });
    await stop?.();
    const appended = await readLogs(logPath);
    expect(appended.records.slice(0, records.length)).toEqual(records);
    expect(appended.records.at(-1)?.sessionId).not.toBe(records[0].sessionId);
  }, 15000);

  it("records metadata and Java worker diagnostics while leaving out payloads and worker text by default", async () => {
    const javaDir = path.join(root, "java 소스", "sample");
    const logPath = "metadata.jsonl";
    const marker = "private-stdio-log-test";
    await fs.mkdir(javaDir, { recursive: true });
    await fs.writeFile(path.join(javaDir, "Sample.java"), `package sample; public class Sample { String label = "${marker}"; }`);
    const client = await start(12000, { path: logPath }, `-Dleflect.log.test=${marker}`);
    const resolved = await client.call("resolve_references", { targets: [{ targetId: marker, kind: "java", className: "sample.Sample" }] });
    const sourceId = resolved.sources![0].sourceId;
    await client.call("get_source", { snapshotId: resolved.snapshotId, sourceId, format: "text" });
    await client.call("analyze_sources", { snapshotId: resolved.snapshotId, sourceIds: [sourceId] });
    await stop?.();

    const { text, records } = await readLogs(logPath);
    expect(text).not.toContain(marker);
    expect(records.every(({ payload, detail }) => payload === undefined && detail === undefined)).toBe(true);
    for (const [tool, worker] of [["resolve_references", "source-syntax"], ["analyze_sources", "parse-java"]]) {
      const requestId = records.find((row) => row.event === "rpc" && row.direction === "in" && row.tool === tool)!.requestId;
      expect(records).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "worker.start", worker, tool, requestId }),
        expect.objectContaining({ event: "worker.output", worker, stream: "stderr", requestId, bytes: expect.any(Number) }),
        expect.objectContaining({ event: "worker.exit", worker, tool, requestId })
      ]));
    }
  }, 20000);

  it("reports log open failures on stderr and continues serving JSON-RPC", async () => {
    const logPath = "occupied.jsonl";
    await fs.mkdir(path.join(root, logPath));
    const client = await start(12000, { path: logPath });
    const { result } = await client.rpc("tools/list");
    expect(result.tools).toHaveLength(3);
    await stop?.();
    expect(client.stderr().match(/\[leflect-mcp-log\]/g)).toHaveLength(1);
  }, 10000);

  it("keeps bytes and worker analysis frozen while paginating Unicode paths and references", async () => {
    await fs.mkdir(path.join(root, "java 소스", "app"), { recursive: true });
    const java = path.join(root, "java 소스", "app", "PayService.java");
    const original = "package app;\r\npublic class PayService {\r\n  public String load() { return \"이전\".trim(); }\r\n}\r\n" + "// 한글😀\n".repeat(550);
    await fs.writeFile(java, original);
    await fs.writeFile(path.join(root, "거래 화면.jsp"), '<%@ page import="app.*" %>\n<% ' + "new PayService().load(); ".repeat(18) + "%>");
    const client = await start();
    const { result: listing } = await client.rpc("tools/list");
    expect(listing.tools?.map(({ name }) => name)).toEqual(["resolve_references", "get_source", "analyze_sources"]);
    expect(listing.tools?.every(({ inputSchema, outputSchema }) => inputSchema && outputSchema)).toBe(true);
    const resolution = await client.pages("resolve_references", { targets: [
      { targetId: "page", kind: "jsp", path: "/거래 화면.jsp" },
      { targetId: "java", kind: "java", className: "app.PayService" },
      { targetId: "missing", kind: "jsp", path: "/missing.jsp" }
    ], scope: { followReferences: true } });
    const [initial] = resolution;
    expect(initial.status).toBe("partial");
    expect(resolution.flatMap((page) => page.targets ?? []).map(({ targetId, status }) => [targetId, status]))
      .toEqual([["page", "resolved"], ["java", "resolved"], ["missing", "missing"]]);
    expect(resolution.some((page) => page.fragments?.length)).toBe(true);
    expect(resolution.flatMap((page) => page.references ?? []).filter(({ expression }) => expression === "PayService"),
      JSON.stringify(resolution.flatMap((page) => page.diagnostics))).toHaveLength(18);
    const source = resolution.flatMap((page) => page.sources ?? []).find((entry) => entry.path === "app/PayService.java")!;
    const jsp = resolution.flatMap((page) => page.sources ?? []).find((entry) => entry.path === "거래 화면.jsp")!;
    const hash = createHash("sha256").update(original).digest("hex");
    expect(source.sourceHash).toBe(hash);
    await fs.writeFile(java, "package app; public class PayService { public void changed() {} }");
    const frozen = { snapshotId: initial.snapshotId, sourceId: source.sourceId };
    const bytes = await client.pages("get_source", { ...frozen, format: "bytes" });
    expect(bytes.length).toBeGreaterThan(1);
    expect(Buffer.concat(bytes.map((page) => Buffer.from(page.data!, "base64"))).toString("utf8")).toBe(original);
    expect(bytes.every((page) => page.source?.sourceHash === hash)).toBe(true);
    const text = await client.pages("get_source", { ...frozen, format: "text" });
    expect(text.map((page) => page.data).join("")).toBe(original);
    const analyzed = await client.pages("analyze_sources", { snapshotId: initial.snapshotId, sourceIds: [source.sourceId, jsp.sourceId] });
    expect(analyzed.flatMap((page) => page.sources ?? []).find(({ sourceId }) => sourceId === source.sourceId)?.sourceHash).toBe(hash);
    expect(analyzed.flatMap((page) => page.results ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "call", location: expect.objectContaining({ path: "app/PayService.java", line: 3 }), detail: expect.objectContaining({ targetMethodName: "trim" }) }),
      expect.objectContaining({ kind: "call", location: expect.objectContaining({ path: "거래 화면.jsp", line: 2 }), detail: expect.objectContaining({ targetMethodName: "load" }) })
    ]));
    await fs.writeFile(path.join(root, "missing.jsp"), "new source");
    const expanded = await client.pages("resolve_references", {
      baseSnapshotId: initial.snapshotId, targets: [
        { targetId: "missing", kind: "jsp", path: "/missing.jsp" },
        { targetId: "prior", kind: "source", sourceId: source.sourceId }
      ]
    });
    expect(expanded.flatMap((page) => page.targets ?? [])).toMatchObject([
      { targetId: "missing", status: "missing" },
      { targetId: "prior", status: "resolved", sourceId: source.sourceId }
    ]);
    const fresh = await client.pages("resolve_references", { targets: [{ targetId: "java", kind: "java", className: "app.PayService" }] });
    expect(fresh[0].snapshotId).not.toBe(initial.snapshotId);
    expect(fresh.flatMap((page) => page.sources ?? [])[0].sourceHash).not.toBe(hash);
    await stop?.();
    const restarted = await start();
    expect(await restarted.call("get_source", { ...frozen, format: "bytes" }))
      .toMatchObject({ status: "failed", diagnostics: [{ code: "SNAPSHOT_EXPIRED" }] });
  }, 25000);

  it("reports unprocessed targets when the worker exceeds the workspace timeout", async () => {
    const dir = path.join(root, "java 소스", "app");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "A.java"), "package app; public class A {}");
    const logPath = "timeout.jsonl";
    const client = await start(1, { path: logPath });
    const pages = await client.pages("resolve_references", { targets: [{ targetId: "timed", kind: "java", className: "app.A" }] });
    expect(pages[0].status).toBe("partial");
    expect(pages.flatMap((page) => page.targets ?? [])).toMatchObject([{ targetId: "timed", status: "limit" }]);
    expect(pages.flatMap((page) => page.unprocessedTargetIds ?? [])).toEqual(["timed"]);
    await stop?.();
    const { records } = await readLogs(logPath);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "tool.timeout", tool: "resolve_references", timeoutMs: 1 }),
      expect.objectContaining({ event: "lookup.summary", status: "partial", diagnosticCodes: expect.arrayContaining(["SOURCE_LIMIT"]) })
    ]));
  }, 10000);
});
