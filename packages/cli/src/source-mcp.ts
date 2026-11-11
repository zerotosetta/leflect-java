import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";

import { loadConfig } from "@leflect-java/core";
import type { LeflectConfig } from "@leflect-java/schema";

import { analysisKinds, SnapshotAnalyzer, type AnalysisKind } from "./source-analysis";
import type { SourceTarget } from "./source-contract";
import { describeSource, SourceRequestError, SourceResolution } from "./source-resolution";
import type { SourceFile } from "./source-workspace";

type JsonObject = Record<string, unknown>;
type RequestId = string | number | null;
type ToolName = "resolve_references" | "get_source" | "analyze_sources";
type Page = JsonObject & { snapshotId: string; nextCursor: string | null };
type SizeCheck = (page: Page) => boolean;
type PageBuilder = (cursor: string, fits: SizeCheck) => { page: Page; next?: PageBuilder };

const protocolVersions = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const toolNames = new Set<ToolName>(["resolve_references", "get_source", "analyze_sources"]);
const nonemptyString = { type: "string", minLength: 1 };
const nonnegativeInteger = { type: "integer", minimum: 0 };
const positiveInteger = { type: "integer", minimum: 1 };
const nullableString = { type: ["string", "null"] };
const cursorSchema = objectSchema({ cursor: nonemptyString }, ["cursor"]);
const targetId = nonemptyString;
const lookupStatuses = ["resolved", "ambiguous", "missing", "binary_only", "unsupported", "dynamic", "blocked", "limit"];
const descriptor = objectSchema({
  sourceId: nonemptyString, sourceHash: nonemptyString, rootId: nonemptyString, path: nonemptyString,
  kind: { enum: ["java", "jsp"] }, encoding: nonemptyString, byteLength: nonnegativeInteger
}, ["sourceId", "sourceHash", "rootId", "path", "kind", "encoding", "byteLength"]);

function objectSchema(properties: JsonObject, required: string[], additionalProperties = false) {
  return { type: "object", properties, required, additionalProperties };
}

function listOf(items: JsonObject, minItems = 0) {
  return { type: "array", items, minItems };
}

function withCursor(properties: JsonObject, required: string[]) {
  return { type: "object", oneOf: [cursorSchema, objectSchema(properties, required)] };
}

function resultSchema(properties: JsonObject, required: string[]) {
  return objectSchema({
    schemaVersion: { const: 1 },
    snapshotId: nonemptyString,
    status: { enum: ["complete", "partial", "failed"] },
    nextCursor: nullableString,
    diagnostics: listOf(objectSchema({ code: nonemptyString, message: nonemptyString }, ["code", "message"], true)),
    ...properties
  }, ["schemaVersion", "snapshotId", "status", "nextCursor", "diagnostics", ...required]);
}

const fragmentSchema = listOf(objectSchema({
  section: nonemptyString, index: nonnegativeInteger, offset: nonnegativeInteger,
  data: { type: "string" }, last: { type: "boolean" }
}, ["section", "index", "offset", "data", "last"]));

const toolDefinitions = [
  {
    name: "resolve_references",
    description: "Resolve logical JSP paths and Java type names within the configured workspace.",
    inputSchema: withCursor({
      targets: listOf({ oneOf: [
        objectSchema({ targetId, kind: { const: "jsp" }, path: nonemptyString }, ["targetId", "kind", "path"]),
        objectSchema({ targetId, kind: { const: "java" }, className: nonemptyString }, ["targetId", "kind", "className"]),
        objectSchema({ targetId, kind: { const: "source" }, sourceId: nonemptyString }, ["targetId", "kind", "sourceId"])
      ] }, 1),
      baseSnapshotId: nonemptyString,
      scope: objectSchema({ followReferences: { type: "boolean" }, maxDepth: nonnegativeInteger }, [])
    }, ["targets"]),
    outputSchema: resultSchema({
      targets: listOf(objectSchema({ targetId, status: { enum: lookupStatuses } }, ["targetId", "kind", "status", "candidates"], true)),
      references: listOf(objectSchema({ targetId, status: { enum: lookupStatuses } }, ["targetId", "kind", "expression", "location", "status", "candidates"], true)),
      sources: listOf(descriptor),
      unprocessedTargetIds: listOf(nonemptyString), fragments: fragmentSchema
    }, ["targets", "references", "sources", "unprocessedTargetIds"])
  },
  {
    name: "get_source",
    description: "Read frozen source text or original bytes from a snapshot.",
    inputSchema: withCursor({
      snapshotId: nonemptyString, sourceId: nonemptyString, format: { enum: ["text", "bytes"] },
      startLine: positiveInteger, lineCount: nonnegativeInteger, offset: nonnegativeInteger, length: nonnegativeInteger
    }, ["snapshotId", "sourceId", "format"]),
    outputSchema: resultSchema({
      source: descriptor, format: { enum: ["text", "bytes"] }, data: { type: "string" },
      offset: nonnegativeInteger, length: nonnegativeInteger,
      startLine: positiveInteger, startColumn: positiveInteger, endLine: positiveInteger, endColumn: positiveInteger, lineCount: nonnegativeInteger
    }, ["source", "format", "data"])
  },
  {
    name: "analyze_sources",
    description: "Extract Java classes, methods, calls, and diagnostics from the frozen sources.",
    inputSchema: withCursor({
      snapshotId: nonemptyString, sourceIds: listOf(nonemptyString, 1), kinds: listOf({ enum: analysisKinds }, 1)
    }, ["snapshotId", "sourceIds"]),
    outputSchema: resultSchema({
      parserVersion: nullableString,
      sources: listOf(descriptor),
      results: listOf(objectSchema({ sourceId: nonemptyString, kind: { enum: analysisKinds } }, ["sourceId", "kind", "detail"], true)),
      coverage: listOf(objectSchema({ sourceId: nonemptyString, status: { enum: ["complete", "partial"] } }, ["sourceId", "status", "kinds"], true)),
      fragments: fragmentSchema
    }, ["parserVersion", "sources", "results", "coverage"])
  }
] as const;

export async function runSourceMcp(argv: string[]): Promise<void> {
  if (argv.length !== 2 || argv[0] !== "--config" || !argv[1] || argv[1].startsWith("--")) {
    throw new Error("Usage: leflect mcp --config <file>");
  }
  const configPath = path.resolve(argv[1]);
  const log = console.log;
  const info = console.info;
  const debug = console.debug;
  console.log = console.info = console.debug = console.error;
  try {
    const { config, loaded } = await loadConfig({ configPath, root: path.dirname(configPath) });
    if (!loaded || !config.sourceResolution) throw new Error("MCP requires a config file with sourceResolution.");
    await new SourceMcpServer(config).serve();
  } finally {
    console.log = log;
    console.info = info;
    console.debug = debug;
  }
}

class SourceMcpServer {
  private readonly resolution: SourceResolution;
  private readonly analyzer: SnapshotAnalyzer;
  private readonly cursors = new Map<string, { name: ToolName; snapshotId: string; next: PageBuilder }>();
  private readonly active = new Map<RequestId, AbortController>();
  private initialized = false;
  private negotiated = false;

  constructor(config: LeflectConfig) {
    this.resolution = new SourceResolution(config);
    this.analyzer = new SnapshotAnalyzer(config.java);
  }

  async serve(): Promise<void> {
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const requests = new Set<Promise<void>>();
    lines.on("line", (line) => {
      const request = this.receive(line);
      requests.add(request);
      void request.finally(() => requests.delete(request));
    });
    await new Promise<void>((resolve) => lines.once("close", resolve));
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled(requests);
  }

  private async receive(line: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } });
      return;
    }
    if (!isObject(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string"
      || (raw.id !== undefined && typeof raw.id !== "string" && typeof raw.id !== "number" && raw.id !== null)) {
      this.write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
      return;
    }
    const { id, method, params } = raw as { id?: RequestId; method: string; params?: unknown };
    if (id === undefined) {
      if (method === "notifications/initialized" && this.negotiated) this.initialized = true;
      if (method === "notifications/cancelled" && isObject(params)) {
        this.active.get(params.requestId as RequestId)?.abort(new Error("MCP request cancelled."));
      }
      return;
    }
    const reply = (result: JsonObject) => this.write({ jsonrpc: "2.0", id, result });
    const error = (code: number, message: string) => this.write({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize") {
      if (this.negotiated || !isObject(params) || typeof params.protocolVersion !== "string") {
        error(-32602, "Invalid initialize request.");
        return;
      }
      this.negotiated = true;
      reply({
        protocolVersion: protocolVersions.has(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
        serverInfo: { name: "leflect-java", version: "1" },
        capabilities: { tools: {} }
      });
    } else if (method === "ping") {
      reply({});
    } else if (!this.initialized) {
      error(-32002, "The MCP session has not been initialized.");
    } else if (method === "tools/list") {
      reply({ tools: toolDefinitions });
    } else if (method !== "tools/call") {
      error(-32601, "Unknown MCP method.");
    } else {
      if (this.active.has(id)) {
        error(-32600, "Request ID is already in use.");
        return;
      }
      const controller = new AbortController();
      this.active.set(id, controller);
      const execution = new AbortController();
      const cancel = () => execution.abort(controller.signal.reason);
      controller.signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => execution.abort(new Error("MCP request timed out.")),
        Math.min(this.resolution.workspace.limits.timeoutMs, 2_147_483_647));
      const { signal } = execution;
      try {
        const page = await this.callTool(params, id, signal);
        if (!controller.signal.aborted) reply(toolResult(page));
      } catch (cause) {
        if (controller.signal.aborted) return;
        const failure = cause instanceof SourceRequestError ? cause : new SourceRequestError(
          signal.aborted ? "SOURCE_LIMIT" : "TOOL_FAILED",
          signal.aborted ? "The request exceeded its time limit." : "The tool could not complete the operation."
        );
        reply(toolResult({
          schemaVersion: 1, status: "failed", nextCursor: null,
          diagnostics: [{ code: failure.code, message: failure.message }]
        }, true));
      } finally {
        clearTimeout(timer);
        this.active.delete(id);
      }
    }
  }

  private async callTool(params: unknown, id: RequestId, signal: AbortSignal): Promise<Page> {
    if (!isObject(params) || !toolNames.has(params.name as ToolName)) invalid("Unknown source tool.");
    const name = params.name as ToolName;
    const args = fields(params.arguments, name === "resolve_references" ? ["targets", "scope", "baseSnapshotId", "cursor"] :
      name === "get_source" ? ["snapshotId", "sourceId", "format", "startLine", "lineCount", "offset", "length", "cursor"] :
        ["snapshotId", "sourceIds", "kinds", "cursor"]);
    let builder: PageBuilder;
    if (args.cursor !== undefined) {
      fields(args, ["cursor"]);
      const cursor = this.cursors.get(string(args.cursor));
      if (!cursor) throw new SourceRequestError("SNAPSHOT_EXPIRED", "The source page cursor has expired.");
      if (cursor.name !== name) invalid("The cursor belongs to a different tool.");
      this.resolution.getSnapshot(cursor.snapshotId);
      builder = cursor.next;
    } else if (name === "resolve_references") {
      const targets = array(args.targets).map(parseTarget);
      const scope = args.scope === undefined ? undefined : fields(args.scope, ["followReferences", "maxDepth"]);
      if (scope?.followReferences !== undefined && typeof scope.followReferences !== "boolean") invalid("Invalid followReferences.");
      const result = await this.resolution.resolveReferences({
        targets,
        baseSnapshotId: args.baseSnapshotId === undefined ? undefined : string(args.baseSnapshotId),
        scope: {
          followReferences: scope?.followReferences as boolean | undefined,
          maxDepth: scope?.maxDepth === undefined ? undefined : integer(scope.maxDepth)
        }
      }, signal);
      const { targets: rows, references, sources, diagnostics, unprocessedTargetIds, ...base } = result;
      builder = paginateRows(base, { targets: rows, sources, references, diagnostics, unprocessedTargetIds });
    } else {
      const snapshot = this.resolution.getSnapshot(string(args.snapshotId));
      if (name === "get_source") {
        const source = snapshot.sources.get(string(args.sourceId));
        if (!source) throw new SourceRequestError("SOURCE_NOT_FOUND", "The source ID was not issued by this snapshot.");
        builder = paginateSource(snapshot.id, source, args);
      } else {
        const sourceIds = array(args.sourceIds).map(string);
        if (new Set(sourceIds).size !== sourceIds.length) invalid("Duplicate sourceIds.");
        const kinds = args.kinds === undefined ? [...analysisKinds] : array(args.kinds).map((value) => {
          if (!analysisKinds.includes(value as AnalysisKind)) invalid("Unknown analysis result kind.");
          return value as AnalysisKind;
        });
        const { sources, results, coverage, diagnostics, ...base } = await this.analyzer.analyze(snapshot, sourceIds, kinds, signal);
        builder = paginateRows(base, { sources, coverage, results, diagnostics });
      }
    }
    const cursor = randomUUID();
    const { page, next } = builder(cursor, (candidate) =>
      Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id, result: toolResult(candidate) }) + "\n", "utf8")
        <= this.resolution.workspace.limits.maxResponseBytes);
    if (next) {
      this.cursors.set(cursor, { name, snapshotId: page.snapshotId, next });
      if (this.cursors.size > 128) this.cursors.delete(this.cursors.keys().next().value!);
    }
    return page;
  }

  private write(message: JsonObject): void {
    process.stdout.write(JSON.stringify(message) + "\n", "utf8");
  }
}

function toolResult(structuredContent: JsonObject, isError = false) {
  return {
    ...(isError ? { isError, content: [{ type: "text", text: JSON.stringify(structuredContent) }] } : {
      structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }]
    })
  };
}

function paginateRows(base: Page, sections: Record<string, readonly unknown[]>): PageBuilder {
  const rows = Object.entries(sections).flatMap(([key, values]) => values.map((value, index) => ({ key, index, value })));
  const keys = Object.keys(sections);
  const emptyPage = (): Page => ({ ...base, nextCursor: null, ...Object.fromEntries(keys.map((key) => [key, []])) });
  const build = (start: number): PageBuilder => (cursor, fits) => {
    const page = emptyPage();
    let index = start;
    for (; index < rows.length; index += 1) {
      const { key, value } = rows[index];
      const values = page[key] as unknown[];
      values.push(value);
      page.nextCursor = index + 1 < rows.length ? cursor : null;
      if (fits(page)) continue;
      values.pop();
      break;
    }
    page.nextCursor = index < rows.length ? cursor : null;
    if (index === start && index < rows.length) {
      const row = rows[index];
      const serialized = JSON.stringify(row.value);
      const remaining = index + 1 < rows.length;
      const fragment = (startOffset: number): PageBuilder => (fragmentCursor, fragmentFits) => {
        const builder = paginateRange(startOffset, serialized.length, (offset, end, nextCursor) => {
          const last = nextCursor === null;
          return {
            ...emptyPage(), nextCursor: last && remaining ? fragmentCursor : nextCursor,
            fragments: [{ section: row.key, index: row.index, offset, data: serialized.slice(offset, end), last }]
          };
        }, (boundary) => surrogateBoundary(serialized, boundary));
        const result = builder(fragmentCursor, fragmentFits);
        const [part] = result.page.fragments as { offset: number; data: string; last: boolean }[];
        return { page: result.page, next: part.last ? (remaining ? build(index + 1) : undefined) : fragment(part.offset + part.data.length) };
      };
      return fragment(0)(cursor, fits);
    }
    if (!fits(page)) throw new SourceRequestError("RESPONSE_LIMIT", "The result envelope exceeds the configured response byte budget.");
    return { page, next: index < rows.length ? build(index) : undefined };
  };
  return build(0);
}

function paginateSource(snapshotId: string, source: SourceFile, args: JsonObject): PageBuilder {
  const base = { snapshotId, schemaVersion: 1, status: "complete", diagnostics: [], source: describeSource(source) };
  const { format } = args;
  if (format === "bytes") {
    if (args.startLine !== undefined || args.lineCount !== undefined) invalid("Line ranges require text format.");
    const start = integer(args.offset ?? 0);
    if (start > source.bytes.length) invalid("Byte offset is past the end of the source.");
    const end = start + Math.min(integer(args.length ?? source.bytes.length), source.bytes.length - start);
    return paginateRange(start, end, (offset, limit, nextCursor) => ({
      ...base, nextCursor, format, offset, length: limit - offset, data: source.bytes.subarray(offset, limit).toString("base64")
    }));
  }
  if (format !== "text") invalid("Specify text or bytes format.");
  if (args.offset !== undefined || args.length !== undefined) invalid("Byte ranges require bytes format.");
  const starts = [0];
  for (const match of source.text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  const firstLine = integer(args.startLine ?? 1, 1);
  if (firstLine > starts.length) invalid("Starting line is past the end of the source.");
  const lineCount = integer(args.lineCount ?? starts.length);
  const start = starts[firstLine - 1];
  const end = starts[firstLine - 1 + Math.min(lineCount, starts.length)] ?? source.text.length;
  const position = (offset: number) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
  return paginateRange(start, end, (offset, limit, nextCursor) => {
    const first = position(offset);
    const last = position(limit);
    return {
      ...base, nextCursor, format, data: source.text.slice(offset, limit),
      startLine: first.line, startColumn: first.column, endLine: last.line, endColumn: last.column,
      lineCount: limit === offset ? 0 : position(limit - 1).line - first.line + 1
    };
  }, (boundary) => surrogateBoundary(source.text, boundary));
}

function surrogateBoundary(text: string, boundary: number): number {
  const unit = text.charCodeAt(boundary);
  return unit >= 0xdc00 && unit <= 0xdfff ? boundary - 1 : boundary;
}

function paginateRange(
  start: number, end: number, makePage: (start: number, end: number, cursor: string | null) => Page,
  adjustBoundary: (boundary: number) => number = (boundary) => boundary
): PageBuilder {
  const build = (offset: number): PageBuilder => (cursor, fits) => {
    const finalPage = makePage(offset, end, null);
    if (fits(finalPage)) return { page: finalPage };
    let low = offset;
    let high = end;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(makePage(offset, adjustBoundary(mid), cursor))) low = mid;
      else high = mid;
    }
    const boundary = adjustBoundary(low);
    if (boundary <= offset) throw new SourceRequestError("RESPONSE_LIMIT", "The source range cannot fit the configured response byte budget.");
    return { page: makePage(offset, boundary, cursor), next: build(boundary) };
  };
  return build(start);
}

function parseTarget(value: unknown): SourceTarget {
  if (!isObject(value)) invalid("Each target must be an object.");
  const targetId = string(value.targetId);
  if (value.kind === "jsp") {
    fields(value, ["targetId", "kind", "path"]);
    return { targetId, kind: "jsp", path: string(value.path) };
  }
  if (value.kind === "java") {
    fields(value, ["targetId", "kind", "className"]);
    return { targetId, kind: "java", className: string(value.className) };
  }
  if (value.kind === "source") {
    fields(value, ["targetId", "kind", "sourceId"]);
    return { targetId, kind: "source", sourceId: string(value.sourceId) };
  }
  return invalid("Unknown source target kind.");
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fields(value: unknown, allowed: string[]): JsonObject {
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid("Invalid tool arguments.");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) invalid("Expected a nonempty string of at most 2048 characters.");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid("Invalid integer range.");
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0) invalid("Expected a nonempty array.");
  return value;
}

function invalid(message: string): never {
  throw new SourceRequestError("INVALID_ARGUMENTS", message);
}
