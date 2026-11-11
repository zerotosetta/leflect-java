import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runJavaWorker, writeJavaManifest } from "@leflect-java/java-bridge";
import type { LeflectConfig } from "@leflect-java/schema";

import type { EvidenceLocation } from "./source-contract";
import { describeSource, locateSource, type SourceSnapshot } from "./source-resolution";
import { buildJspJava, type SyntaxLocation } from "./source-syntax";
import type { SourceFile } from "./source-workspace";
import { resolveJavaWorkerJar } from "./worker-jar";

export type AnalysisKind = "class" | "method" | "call" | "diagnostic";
export const analysisKinds: readonly AnalysisKind[] = ["class", "method", "call", "diagnostic"];

type AnalysisRecord = {
  kind: AnalysisKind;
  sourceId: string;
  location?: EvidenceLocation;
  entrySourceId?: string;
  detail: Record<string, unknown>;
};

type Input = {
  text: string;
  relativePath: string;
  sourceIds: ReadonlySet<string>;
  locate(position: SyntaxLocation): EvidenceLocation | undefined;
  entrySourceId?: string;
};

type WorkerRow = {
  path: string;
  types: (Record<string, unknown> & { methods?: Record<string, unknown>[] })[];
  methodCalls: Record<string, unknown>[];
  referenceDiagnostics?: Record<string, unknown>[];
};

export class SnapshotAnalyzer {
  private readonly cache = new WeakMap<SourceSnapshot, Map<string, Awaited<ReturnType<SnapshotAnalyzer["run"]>>>>();

  constructor(private readonly java?: LeflectConfig["java"]) {}

  async analyze(
    snapshot: SourceSnapshot, sourceIds: string[], kinds: AnalysisKind[], signal: AbortSignal
  ) {
    const jar = await resolveJavaWorkerJar(this.java?.workerJar);
    const workerBytes = jar ? await fs.readFile(jar, { signal }) : undefined;
    const parserVersion = workerBytes ? "sha256:" + createHash("sha256").update(workerBytes).digest("hex") : null;
    const key = JSON.stringify([parserVersion, sourceIds, kinds]);
    let entries = this.cache.get(snapshot);
    if (!entries) this.cache.set(snapshot, entries = new Map());
    const cached = entries.get(key);
    if (cached) return cached;
    const result = await this.run(snapshot, sourceIds, kinds, signal, workerBytes, parserVersion);
    if (result.status === "complete") entries.set(key, result);
    return result;
  }

  private async run(
    snapshot: SourceSnapshot, sourceIds: string[], kinds: AnalysisKind[], signal: AbortSignal,
    workerBytes: Buffer | undefined, parserVersion: string | null
  ) {
    const result = {
      schemaVersion: 1 as const,
      status: "complete" as "complete" | "partial",
      nextCursor: null,
      snapshotId: snapshot.id,
      parserVersion,
      sources: sourceIds.flatMap((id) => {
        const source = snapshot.sources.get(id);
        return source ? [describeSource(source)] : [];
      }),
      results: [] as AnalysisRecord[],
      coverage: sourceIds.map((sourceId) => ({ sourceId, status: "complete" as "complete" | "partial", kinds })),
      diagnostics: [] as { code: string; message: string; sourceId?: string; location?: EvidenceLocation }[]
    };
    const selected = new Set(sourceIds);
    const report = (code: string, message: string, sourceId?: string, location?: EvidenceLocation) => {
      result.status = "partial";
      result.diagnostics.push({ code, message, sourceId, location });
      for (const coverage of result.coverage) {
        if (!sourceId || coverage.sourceId === sourceId) coverage.status = "partial";
      }
    };
    for (const diagnostic of snapshot.classpath.diagnostics) report(diagnostic.code, diagnostic.message);
    const declarationSources = new Map<string, Set<string>>();
    for (const [sourceId, declarations] of snapshot.javaDeclarations) {
      for (const { className } of declarations) {
        let ids = declarationSources.get(className);
        if (!ids) declarationSources.set(className, ids = new Set());
        ids.add(sourceId);
      }
    }
    const ambiguous = new Set([...declarationSources.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]));
    if (ambiguous.size > 0) report("SOURCE_AMBIGUOUS", "Duplicate type declarations were excluded from the analysis classpath.");
    const inputs: Input[] = [];
    for (const id of sourceIds) {
      const source = snapshot.sources.get(id);
      if (!source) report("SOURCE_NOT_FOUND", "The source ID was not issued by this snapshot.", id);
      else if (source.kind === "jsp" && ![...snapshot.jspUnits.values()].some(({ sources }) => sources.has(id))) {
        report("JSP_CONTEXT_UNAVAILABLE", "Resolve the JSP as a page to collect its translation context.", id);
      }
    }
    for (const source of snapshot.sources.values()) {
      if (source.kind !== "java" || ambiguous.has(source.sourceId)) continue;
      const declarations = snapshot.javaDeclarations.get(source.sourceId);
      if (!declarations?.length) {
        if (selected.has(source.sourceId)) report("JAVA_DECLARATION_UNAVAILABLE", "The Java type declaration could not be established.", source.sourceId);
        continue;
      }
      inputs.push(javaInput(source, declarations[0].className));
    }
    for (const [unitKey, unit] of snapshot.jspUnits) {
      if (!unit.parts.length || ![...unit.sources].some((id) => selected.has(id))) continue;
      const generated = buildJspJava(unit.parts, unit.imports.map(({ entry }) => entry));
      const unitId = createHash("sha256").update(unitKey).digest("hex").slice(0, 24);
      inputs.push({
        text: generated.text,
        relativePath: "jsp/" + unitId + "/Page.java",
        sourceIds: unit.sources,
        entrySourceId: unitKey.split("\0").at(-1),
        locate(position) {
          const original = generated.mapLocation(position);
          return original ? locateSource(unit.parts[original.partIndex].source, original.location) : undefined;
        }
      });
    }
    if (!inputs.some((input) => [...input.sourceIds].some((id) => selected.has(id)))) return result;
    if (!workerBytes) {
      report("WORKER_UNAVAILABLE", "The LeflectJava worker JAR is unavailable.");
      return result;
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-snapshot-"));
    try {
      const root = path.join(directory, "source");
      const outputDir = path.join(directory, "java-ast");
      const errorLog = path.join(directory, "java-problems.jsonl");
      const manifest = path.join(directory, "manifest.json");
      const workerJar = path.join(directory, "leflect-worker.jar");
      const classpathEntries = await snapshot.classpath.materialize(path.join(directory, "classpath"), signal);
      await fs.writeFile(workerJar, workerBytes, { signal });
      for (const input of inputs) {
        signal.throwIfAborted();
        const file = path.join(root, input.relativePath);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, input.text, { encoding: "utf8", signal });
      }
      await writeJavaManifest(manifest, {
        root, outputDir, errorLog, classpathEntries, isolatedClasspath: true, files: inputs.map(({ relativePath }) => relativePath)
      });
      const worker = await runJavaWorker({
        jarPath: workerJar, args: ["parse-java", "--manifest", manifest], cwd: directory,
        javaHome: this.java?.javaHome, jreHome: this.java?.jreHome, signal
      });
      if (worker.code !== 0) {
        report("WORKER_FAILED", "The LeflectJava worker failed to analyze the frozen input.");
        return result;
      }
      const byPath = new Map(inputs.map((input) => [input.relativePath, input]));
      const summary = await readJsonLines<WorkerRow>(path.join(directory, "index", "java-summary.jsonl"));
      const found = new Set(summary.map(({ path }) => path));
      for (const input of inputs) {
        if (found.has(input.relativePath)) continue;
        for (const sourceId of input.sourceIds) {
          if (selected.has(sourceId)) report("WORKER_INCOMPLETE", "The worker returned no analysis for this source.", sourceId);
        }
      }
      const emit = (input: Input, kind: AnalysisKind, row: Record<string, unknown>) => {
        const position = row.location as SyntaxLocation | undefined;
        const location = position ? input.locate(position) : undefined;
        const sourceId = location?.sourceId ?? (input.entrySourceId ? undefined : input.sourceIds.values().next().value);
        if (!sourceId || !selected.has(sourceId)) return;
        if (kind === "diagnostic") report(String(row.category ?? "WORKER_DIAGNOSTIC"), String(row.summary ?? row.message ?? "The parser reported incomplete evidence."), sourceId, location);
        if (kind === "call" && !row.resolvedMethodId) report("JAVA_CALL_UNRESOLVED", "The worker did not resolve the call target.", sourceId, location);
        if (kinds.includes(kind)) result.results.push({ kind, sourceId, location, entrySourceId: input.entrySourceId, detail: analysisDetail(kind, row) });
      };
      for (const row of summary) {
        const input = byPath.get(row.path);
        if (!input) continue;
        for (const type of row.types) {
          emit(input, "class", type);
          for (const method of type.methods ?? []) emit(input, "method", method);
        }
        for (const call of row.methodCalls ?? []) emit(input, "call", call);
        for (const diagnostic of row.referenceDiagnostics ?? []) emit(input, "diagnostic", diagnostic);
      }
      for (const row of await readJsonLines<Record<string, unknown>>(errorLog)) {
        const input = byPath.get(String(row.path));
        if (!input) continue;
        emit(input, "diagnostic", row);
        if (input.entrySourceId && !row.location && selected.has(input.entrySourceId)) {
          report("JSP_SCRIPTLET_PARSE", "The parser reported a problem in the JSP translation unit.", input.entrySourceId);
        }
      }
    } catch (error) {
      const changed = (error as { code?: string }).code === "SOURCE_CHANGED";
      report(signal.aborted ? "SOURCE_LIMIT" : changed ? "SOURCE_CHANGED" : "WORKER_FAILED",
        signal.aborted ? "The analysis exceeded its time limit." : changed
          ? "The configured classpath has changed since the snapshot was captured."
          : "The LeflectJava worker could not analyze the frozen input.");
    } finally {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
    return result;
  }
}

function javaInput(source: SourceFile, firstClass: string): Input {
  const parts = firstClass.split(".");
  const originalFile = path.posix.basename(source.path);
  return {
    text: source.text,
    relativePath: path.posix.join("java", source.sourceId, ...parts.slice(0, -1), originalFile),
    sourceIds: new Set([source.sourceId]),
    locate: (position) => locateSource(source, position)
  };
}

async function readJsonLines<T>(file: string): Promise<T[]> {
  return (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function analysisDetail(kind: AnalysisKind, row: Record<string, unknown>): Record<string, unknown> {
  const fields = {
    class: ["name", "fqn", "kind", "extendsTypes", "implementsTypes"],
    method: ["id", "name", "returnType", "parameters", "modifiers"],
    call: ["callerMethodId", "callerClassId", "invocationKind", "targetText", "targetClassId", "resolvedClassId",
      "targetMethodId", "resolvedMethodId", "targetMethodName", "expressionType", "expressionTypeStatus"],
    diagnostic: ["category", "summary", "message", "severity", "symbol", "hint"]
  };
  return Object.fromEntries(fields[kind].filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
}
