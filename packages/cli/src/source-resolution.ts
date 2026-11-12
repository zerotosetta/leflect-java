import { randomUUID } from "node:crypto";

import type { LeflectConfig } from "@leflect-java/schema";

import type {
  EvidenceLocation, IncludeContext, ReferenceResult, ResolutionDiagnostic, ResolveReferencesRequest, ResolveReferencesResult,
  SourceDescriptor, SourceResolutionApi, SourceTarget, TargetResult
} from "./source-contract";
import type { McpSystemLogger } from "./source-mcp-log";
import {
  createSourceSyntaxReader,
  parseJspSyntax,
  type JavaSyntax,
  type JspJavaPart,
  type SyntaxImport,
  type SyntaxLocation
} from "./source-syntax";
import {
  SourceWorkspace,
  isJavaClassName,
  normalizeJspPath,
  type SourceClasspath,
  type SourceFile,
  type SourceLookupResult,
  type SourceLookupSession
} from "./source-workspace";

type ImportEvidence = { entry: SyntaxImport; source: SourceFile };
type JspPart = JspJavaPart & { source: SourceFile; context: IncludeContext };
type TypeLookup = { lookup: SourceLookupResult; name?: string; entry?: ImportEvidence; strategy?: string; reason?: string };
type ParentType = { name: string; source?: SourceFile; platform?: boolean };
export type JspTranslationUnit = { parts: JspPart[]; imports: ImportEvidence[]; sources: Set<string> };

export type SourceSnapshot = {
  id: string;
  sources: ReadonlyMap<string, SourceFile>;
  jspPaths: ReadonlyMap<string, string>;
  jspUnits: ReadonlyMap<string, JspTranslationUnit>;
  classpath: SourceClasspath;
  javaDeclarations: ReadonlyMap<string, JavaSyntax["declarations"]>;
  javaLookups: ReadonlyMap<string, Promise<SourceLookupResult>>;
  jspLookups: ReadonlyMap<string, Promise<SourceLookupResult>>;
  evidence: Pick<ResolveReferencesResult, "targets" | "references" | "diagnostics">;
};

export function createSourceResolution(config: LeflectConfig): SourceResolutionApi {
  const resolution = new SourceResolution(config);
  return {
    resolveReferences: async (request) => structuredClone(await resolution.resolveReferences(request))
  };
}

export class SourceResolution {
  readonly workspace: SourceWorkspace;
  private readonly snapshots = new Map<string, SourceSnapshot>();

  constructor(private readonly config: LeflectConfig) {
    this.workspace = new SourceWorkspace(config);
  }

  getSnapshot(id: string): SourceSnapshot {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) throw new SourceRequestError("SNAPSHOT_EXPIRED", "The source snapshot is unavailable.");
    return snapshot;
  }

  async resolveReferences(request: ResolveReferencesRequest, signal?: AbortSignal, log?: McpSystemLogger): Promise<ResolveReferencesResult> {
    if (new Set(request.targets.map(({ targetId }) => targetId)).size !== request.targets.length) {
      throw new SourceRequestError("INVALID_TARGETS", "targetId must be unique.");
    }
    const maxDepth = request.scope?.maxDepth ?? this.workspace.limits.maxDepth;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > this.workspace.limits.maxDepth) {
      throw new SourceRequestError("INVALID_SCOPE", "maxDepth must be within the configured workspace limit.");
    }
    if (request.targets.some(({ kind }) => kind === "source") && !request.baseSnapshotId) {
      throw new SourceRequestError("INVALID_TARGETS", "A source target requires baseSnapshotId.");
    }
    const base = request.baseSnapshotId ? this.getSnapshot(request.baseSnapshotId) : undefined;
    const session = this.workspace.start({ signal, baseSources: base?.sources.values(), baseClasspath: base?.classpath });
    let sequence = 0;
    const trace: McpSystemLogger | undefined = log && ((event, fields, level) =>
      log(event, { ...fields, sequence: ++sequence }, level));
    trace?.("lookup.cache", {
      cache: "classpath_catalog", result: base ? "hit" : "miss", cacheScope: base ? "snapshot" : undefined,
      baseSnapshotId: base?.id
    });
    const classpath = await session.pinClasspath();
    const resolution = new ReferenceCollector(this.config, session, maxDepth, request.scope?.followReferences ?? false, session.signal, base, log, trace);
    resolution.diagnostics.push(...classpath.diagnostics);
    resolution.partial = classpath.diagnostics.length > 0;
    try {
      await resolution.collect(request.targets);
    } finally {
      await resolution.close();
    }
    const snapshot: SourceSnapshot = {
      id: randomUUID(),
      sources: session.sources,
      jspPaths: resolution.jspPaths,
      jspUnits: resolution.jspUnits,
      classpath,
      javaDeclarations: resolution.javaDeclarations,
      javaLookups: await frozenLookups(resolution.javaLookups),
      jspLookups: await frozenLookups(resolution.jspLookups),
      evidence: { targets: resolution.targets, references: resolution.references, diagnostics: resolution.diagnostics }
    };
    this.snapshots.set(snapshot.id, snapshot);
    // Bound session retention while keeping recent snapshots available for reads and expansion.
    if (this.snapshots.size > 16) this.snapshots.delete(this.snapshots.keys().next().value!);
    return {
      schemaVersion: 1,
      status: resolution.partial ? "partial" : "complete",
      snapshotId: snapshot.id,
      nextCursor: null,
      targets: resolution.targets,
      references: resolution.references,
      diagnostics: resolution.diagnostics,
      sources: [...snapshot.sources.values()].map(describeSource),
      unprocessedTargetIds: [...resolution.unprocessed]
    };
  }
}

export class SourceRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function describeSource(source: SourceFile): SourceDescriptor {
  const { sourceId, sourceHash, rootId, path, encoding, kind, bytes } = source;
  return { sourceId, sourceHash, rootId, path, encoding, kind, byteLength: bytes.length };
}

export function locateSource(source: SourceFile, position: SyntaxLocation): EvidenceLocation {
  const { sourceId, sourceHash, rootId, path } = source;
  return { ...position, sourceId, sourceHash, rootId, path };
}

function emptyLookup(status: SourceLookupResult["status"], complete = false): SourceLookupResult {
  return { status, complete, candidates: [], diagnostics: [] };
}

class ReferenceCollector {
  readonly targets: TargetResult[] = [];
  readonly references: ReferenceResult[] = [];
  readonly diagnostics: ResolutionDiagnostic[] = [];
  readonly unprocessed = new Set<string>();
  readonly jspPaths: Map<string, string>;
  readonly jspUnits: Map<string, JspTranslationUnit>;
  readonly javaDeclarations: Map<string, JavaSyntax["declarations"]>;
  partial = false;

  private readonly reader;
  private readonly javaSyntax = new Map<string, Promise<JavaSyntax>>();
  readonly javaLookups: Map<string, Promise<SourceLookupResult>>;
  readonly jspLookups: Map<string, Promise<SourceLookupResult>>;
  private readonly platformTypes = new Map<string, Promise<"public" | "nonpublic" | "missing">>();
  private readonly seenJava = new Map<string, number>();
  private readonly seenPages = new Map<string, number>();
  private readonly inheritedTypes = new Map<string, Promise<TypeLookup | undefined>>();
  private readonly platformMembers = new Map<string, Promise<string[] | undefined>>();
  private readonly traceTargets = new Map<string, number>();
  private steps = 0;
  private lookupId = 0;
  private trace?: McpSystemLogger;

  constructor(
    config: LeflectConfig,
    private readonly session: SourceLookupSession,
    private readonly maxDepth: number,
    private readonly follow: boolean,
    private readonly signal?: AbortSignal,
    private readonly base?: SourceSnapshot,
    log?: McpSystemLogger,
    private readonly lookupLog?: McpSystemLogger
  ) {
    this.reader = createSourceSyntaxReader(config, { signal, log });
    this.jspPaths = new Map(base?.jspPaths);
    this.jspUnits = new Map(base?.jspUnits);
    this.javaDeclarations = new Map(base?.javaDeclarations);
    this.javaLookups = new Map(base?.javaLookups);
    this.jspLookups = new Map(base?.jspLookups);
  }

  async close(): Promise<void> {
    await this.reader.close();
  }

  private async traceLookup(
    targetId: string, context: Record<string, unknown>, resolve: () => Promise<TypeLookup>
  ): Promise<TypeLookup> {
    if (!this.lookupLog) return resolve();
    const previous = this.trace;
    const lookupId = ++this.lookupId;
    const targetIndex = this.traceTargets.get(targetId);
    this.trace = (event, fields, level) => this.lookupLog?.(event, { ...context, ...fields, lookupId, targetIndex }, level);
    this.trace("lookup.start");
    try {
      const result = await resolve();
      this.traceDecision("lookup.decision", result);
      return result;
    } catch (cause) {
      this.trace("lookup.error", {
        reason: this.signal?.aborted ? "SOURCE_LIMIT" : cause instanceof SourceRequestError ? cause.code : "LOOKUP_FAILED"
      }, "warn");
      throw cause;
    } finally {
      this.trace = previous;
    }
  }

  private traceDecision(event: "lookup.decision" | "lookup.probe_result", result: TypeLookup): void {
    if (!this.trace) return;
    const { lookup, name, strategy } = result;
    const { status, complete, diagnostics } = lookup;
    const reason = result.reason ?? lookupReason(lookup, strategy);
    const outcome = status === "resolved" && complete ? (event === "lookup.decision" ? "selected" : "matched") :
      reason === "JAVA_TYPE_ACCESS" ? "rejected" : "retained";
    const candidates = lookup.candidates.map(({ rootId, path, className, sourceId }) => ({
      rootId, path, className, sourceId, reason, outcome
    }));
    this.trace(event, {
      status, complete, className: name, strategy, reason, candidates,
      diagnosticCodes: [...new Set(diagnostics.map(({ code }) => code))].slice(0, 32)
    });
  }

  private traceCache(cache: string, hit: boolean, fields: Record<string, unknown>, snapshot = false): void {
    const trace = this.trace ?? this.lookupLog;
    trace?.("lookup.cache", {
      ...fields, cache, result: hit ? "hit" : "miss",
      cacheScope: hit ? snapshot ? "snapshot" : "request" : undefined
    });
  }

  async collect(targets: SourceTarget[]): Promise<void> {
    const rootsDiagnostics = await this.session.getRootDiagnostics();
    this.diagnostics.push(...rootsDiagnostics);
    if (rootsDiagnostics.some(({ code }) => code !== "SOURCE_ROOT_READY")) this.partial = true;
    const roots: { target: SourceTarget; source?: SourceFile }[] = [];
    for (const [index, target] of targets.entries()) {
      if (this.lookupLog) this.traceTargets.set(target.targetId, index + 1);
      let lookup: SourceLookupResult;
      try {
        const result = await this.traceLookup(target.targetId, { lookupKind: "target", targetKind: target.kind }, async () => {
          this.signal?.throwIfAborted();
          return { lookup: await this.lookupTarget(target), strategy: target.kind === "source" ? "snapshot_source" : "target" };
        });
        lookup = result.lookup;
      } catch (error) {
        if (!this.signal?.aborted) throw error;
        lookup = emptyLookup("limit");
        this.reportLimit(target.targetId, "The source lookup exceeded its time limit.");
      }
      const candidate = lookup.status === "resolved" ? lookup.candidates[0] : undefined;
      const source = candidate?.sourceId ? this.session.sources.get(candidate.sourceId) : undefined;
      if (source && target.kind === "jsp") this.jspPaths.set(source.sourceId, normalizeJspPath(target.path)!);
      this.recordDiagnostics(target.targetId, lookup);
      if (lookup.status !== "resolved") this.partial = true;
      this.targets.push({
        ...target,
        status: lookup.status,
        candidates: lookup.candidates,
        sourceId: candidate?.sourceId ?? (target.kind === "source" ? target.sourceId : undefined),
        sourceHash: candidate?.sourceHash
      });
      roots.push({ target, source });
    }
    for (const { target, source } of roots) {
      if (!source) continue;
      const { targetId } = target;
      try {
        this.signal?.throwIfAborted();
        if (source.kind === "java") await this.collectJava(targetId, source, 0);
        else {
          const logical = target.kind === "jsp" ? normalizeJspPath(target.path)! : this.jspPaths.get(source.sourceId) ?? "/" + source.path;
          await this.collectPage(targetId, source, logical, 0, []);
        }
      } catch (error) {
        if (error instanceof SourceRequestError && error.code === "SOURCE_LIMIT") this.reportLimit(targetId, error.message);
        else if (this.signal?.aborted) this.reportLimit(targetId, "The reference lookup exceeded its time limit.");
        else {
          this.partial = true;
          this.diagnostics.push({ targetId, code: "WORKER_UNAVAILABLE", message: "The source parser could not finish reference extraction." });
        }
      }
    }
  }

  private lookupTarget(target: SourceTarget): Promise<SourceLookupResult> {
    if (target.kind === "java") return this.findType(target.className);
    if (target.kind === "jsp") return this.lookupJsp(target.path);
    const source = this.base?.sources.get(target.sourceId);
    this.traceCache("snapshot_source", !!source, { sourceId: source?.sourceId }, true);
    if (!source) {
      return Promise.resolve({
        ...emptyLookup("missing"),
        diagnostics: [{ code: "SOURCE_NOT_FOUND", message: "The source ID was not issued by the base snapshot." }]
      });
    }
    return Promise.resolve({ ...emptyLookup("resolved", true), candidates: [describeSource(source)] });
  }

  private lookupJsp(logical: string): Promise<SourceLookupResult> {
    const normalized = normalizeJspPath(logical);
    logical = normalized ?? logical;
    let lookup = this.jspLookups.get(logical);
    this.traceCache("jsp_lookup", !!lookup, { logicalPath: normalized }, this.base?.jspLookups.has(logical));
    if (!lookup) {
      lookup = this.session.resolveJsp(logical, this.trace);
      this.jspLookups.set(logical, lookup);
    }
    return lookup;
  }

  private syntax(source: SourceFile): Promise<JavaSyntax> {
    let syntax = this.javaSyntax.get(source.sourceId);
    this.traceCache("java_syntax", !!syntax, { sourceId: source.sourceId, rootId: source.rootId, path: source.path });
    if (!syntax) {
      syntax = this.reader.java(source.text).then((parsed) => {
        this.javaDeclarations.set(source.sourceId, parsed.declarations);
        return parsed;
      });
      this.javaSyntax.set(source.sourceId, syntax);
    }
    return syntax;
  }

  private lookupJava(className: string, fileOwner?: string, requiredOwner?: string): Promise<SourceLookupResult> {
    const key = [className, fileOwner, requiredOwner].join("\0");
    let lookup = this.javaLookups.get(key);
    this.traceCache("java_lookup", !!lookup, {
      className: isJavaClassName(className) ? className : undefined, fileOwner, requiredOwner
    }, this.base?.javaLookups.has(key));
    if (!lookup) {
      lookup = this.session.resolveJava(className, async (source, name) => {
        const syntax = await this.syntax(source);
        const declared = (candidate: string) => syntax.declarations.some(({ className }) => className === candidate);
        if (!declared(name) || (requiredOwner && !declared(requiredOwner))) return false;
        if (this.session.workspace.javaMap.has(name)) return true;
        const expected = fileOwner ?? name;
        const simple = expected.split(".").at(-1)!;
        return expected === (syntax.packageName ? `${syntax.packageName}.${simple}` : simple) && declared(expected);
      }, fileOwner, { searchClasspath: false }, this.trace);
      this.javaLookups.set(key, lookup);
    }
    return lookup;
  }

  private platformType(name: string): Promise<"public" | "nonpublic" | "missing"> {
    let result = this.platformTypes.get(name);
    this.traceCache("platform_type", !!result, { className: name });
    if (!result) {
      const trace = this.trace;
      result = this.reader.platformTypeAccess(name).then((access) => {
        trace?.("lookup.platform", { rootId: "jdk", className: name, access });
        return access;
      }, (error) => {
        if (this.signal?.aborted) throw error;
        trace?.("lookup.platform", { rootId: "jdk", className: name, reason: "WORKER_UNAVAILABLE" }, "warn");
        return "missing";
      });
      this.platformTypes.set(name, result);
    }
    return result;
  }

  private reportLimit(targetId: string, message: string, location?: EvidenceLocation): void {
    this.partial = true;
    this.unprocessed.add(targetId);
    this.diagnostics.push({ targetId, code: "SOURCE_LIMIT", message, location });
  }

  private checkExpansionBudget(): void {
    this.signal?.throwIfAborted();
    if (++this.steps > this.session.workspace.limits.maxProbes * 4) {
      throw new SourceRequestError("SOURCE_LIMIT", "The reference expansion exceeded the request evidence budget.");
    }
  }

  private recordDiagnostics(targetId: string, lookup: SourceLookupResult, location?: EvidenceLocation): void {
    if (!lookup.complete) this.partial = true;
    if (lookup.status === "limit" || lookup.diagnostics.some(({ code }) => code === "SOURCE_LIMIT")) {
      this.unprocessed.add(targetId);
    }
    this.diagnostics.push(...lookup.diagnostics.map((diagnostic) => ({ ...diagnostic, targetId, location })));
  }

  private async collectJava(targetId: string, source: SourceFile, depth: number): Promise<void> {
    const key = targetId + "\0" + source.sourceId;
    const seen = (this.seenJava.get(key) ?? Infinity) <= depth;
    this.traceCache("reference_expansion", seen, { targetIndex: this.traceTargets.get(targetId), sourceId: source.sourceId, kind: "java" });
    if (seen) return;
    this.seenJava.set(key, depth);
    this.signal?.throwIfAborted();
    const syntax = await this.syntax(source);
    this.addSyntaxDiagnostics(targetId, syntax.diagnostics, source);
    const imports = syntax.imports.map((entry) => ({ entry, source }));
    await this.collectImports(targetId, imports, syntax.packageName, depth);
    for (const type of syntax.types) {
      await this.collectType(targetId, type, source, imports, syntax.packageName, depth);
    }
  }

  private async collectPage(targetId: string, source: SourceFile, logical: string, depth: number, ancestors: string[]): Promise<void> {
    const key = targetId + "\0" + logical + "\0" + source.sourceId;
    const seen = (this.seenPages.get(key) ?? Infinity) <= depth;
    this.traceCache("reference_expansion", seen, { targetIndex: this.traceTargets.get(targetId), sourceId: source.sourceId, kind: "jsp", logicalPath: logical });
    if (seen) return;
    this.seenPages.set(key, depth);
    const context: IncludeContext = { entryPath: logical, entrySourceId: source.sourceId, includeChain: [] };
    const unit: JspTranslationUnit = { imports: [], parts: [], sources: new Set() };
    await this.collectFragment(targetId, source, logical, context, unit, depth, ancestors);
    this.jspUnits.set(logical + "\0" + source.sourceId, unit);
    await this.collectImports(targetId, unit.imports, "", depth, context);
    if (unit.parts.length === 0) return;
    const syntax = await this.reader.jsp(unit.parts, unit.imports.map(({ entry }) => entry));
    for (const diagnostic of syntax.diagnostics) {
      const origin = diagnostic.partIndex === undefined ? source : unit.parts[diagnostic.partIndex]?.source ?? source;
      this.addSyntaxDiagnostics(targetId, [diagnostic], origin);
    }
    for (const type of syntax.types) {
      const part = unit.parts[type.partIndex];
      if (part) await this.collectType(targetId, type, part.source, unit.imports, "", depth, part.context);
    }
  }

  private async collectFragment(
    targetId: string,
    source: SourceFile,
    logical: string,
    context: IncludeContext,
    unit: JspTranslationUnit,
    depth: number,
    ancestors: string[]
  ): Promise<void> {
    this.checkExpansionBudget();
    unit.sources.add(source.sourceId);
    const branch = [...ancestors, source.sourceId];
    const syntax = parseJspSyntax(source.text, logical);
    this.addSyntaxDiagnostics(targetId, syntax.diagnostics, source);
    unit.imports.push(...syntax.imports.map((entry) => ({ entry, source })));
    const lineStarts = [0];
    if (syntax.includes.length) {
      for (const line of source.text.matchAll(/\r\n|\r|\n/g)) lineStarts.push(line.index + line[0].length);
    }
    const events = [
      ...syntax.includes.map((include) => ({
        offset: lineStarts[include.location.line - 1] + include.location.column - 1, include
      })),
      ...syntax.scriptlets.map((scriptlet) => ({ offset: scriptlet.codeOffset, scriptlet }))
    ].sort((a, b) => a.offset - b.offset);
    for (const event of events) {
      this.checkExpansionBudget();
      if ("scriptlet" in event) {
        unit.parts.push({ text: source.text, scriptlet: event.scriptlet, source, context });
        continue;
      }
      const include = event.include;
      const location = locateSource(source, include.location);
      const page = include.kind === "translation" ? logical : context.entryPath;
      const rawPath = include.expression.split(/[?#]/, 1)[0];
      const includePath = normalizeJspPath(rawPath, page);
      const { lookup } = await this.traceLookup(targetId, {
        lookupKind: "jsp_include", location, logicalPath: include.dynamic ? undefined : includePath
      }, async () => ({
        lookup: include.dynamic ? emptyLookup("dynamic") : includePath ? await this.lookupJsp(includePath) : emptyLookup("blocked"),
        strategy: include.kind === "translation" ? "translation_include" : "request_include",
        reason: include.dynamic ? "JSP_INCLUDE_DYNAMIC" : !includePath ? "SOURCE_BOUNDARY" : undefined
      }));
      this.references.push({
        targetId, kind: "jsp-include", expression: include.expression, location, context, includeKind: include.kind,
        status: lookup.status, candidates: lookup.candidates
      });
      this.recordDiagnostics(targetId, lookup, location);
      if (lookup.status !== "resolved") this.partial = true;
      if (include.dynamic || !includePath) {
        this.diagnostics.push({
          targetId, location, code: include.dynamic ? "JSP_INCLUDE_DYNAMIC" : "SOURCE_BOUNDARY",
          message: include.dynamic ? "The include path requires runtime evaluation." : "The include path escapes the web root."
        });
        continue;
      }
      const dependency = this.resolvedSource(lookup);
      if (!dependency) continue;
      this.jspPaths.set(dependency.sourceId, includePath);
      if (branch.includes(dependency.sourceId)) {
        this.partial = true;
        this.diagnostics.push({ targetId, location, code: "JSP_INCLUDE_CYCLE", message: "The include revisits a page in the current include chain." });
        continue;
      }
      if (include.kind === "request" && !this.follow) continue;
      if (depth >= this.maxDepth) {
        this.reportLimit(targetId, "The include exceeds the requested depth.", location);
      } else if (include.kind === "translation") {
        await this.collectFragment(targetId, dependency, includePath, {
          ...context, includeChain: [...context.includeChain, location]
        }, unit, depth + 1, branch);
      } else {
        await this.collectPage(targetId, dependency, includePath, depth + 1, branch);
      }
    }
  }

  private addSyntaxDiagnostics(
    targetId: string,
    diagnostics: readonly { code: string; message: string; location?: SyntaxLocation }[],
    source: SourceFile
  ): void {
    if (diagnostics.length) this.partial = true;
    for (const diagnostic of diagnostics) {
      this.diagnostics.push({
        targetId, code: diagnostic.code, message: diagnostic.message,
        location: diagnostic.location ? locateSource(source, diagnostic.location) : undefined
      });
    }
  }

  private resolvedSource(lookup: SourceLookupResult): SourceFile | undefined {
    const id = lookup.status === "resolved" && lookup.complete ? lookup.candidates[0]?.sourceId : undefined;
    return id ? this.session.sources.get(id) : undefined;
  }

  private async collectImports(
    targetId: string, imports: ImportEvidence[], pkg: string, depth: number, context?: IncludeContext
  ): Promise<void> {
    for (const { entry, source } of imports) {
      this.checkExpansionBudget();
      if (entry.wildcard && !entry.static) continue;
      const location = locateSource(source, entry.location);
      const { lookup } = await this.traceLookup(targetId, { lookupKind: "java_import", location, className: entry.name }, async () => ({
        lookup: entry.static ? emptyLookup("unsupported") : await this.exactType(entry.name, pkg, source),
        strategy: entry.static ? "static_import" : "explicit_import",
        reason: entry.static ? "JAVA_IMPORT_UNSUPPORTED" : undefined
      }));
      await this.recordType(targetId, entry.name, location, lookup, depth, { importLocation: location, context });
    }
  }

  private async findType(name: string, requiredOwner?: string): Promise<SourceLookupResult> {
    const lookups = [await this.lookupJava(name, requiredOwner, requiredOwner)];
    if (lookups[0].status === "unsupported") return lookups[0];
    if (!this.session.workspace.javaMap.has(name)) {
      // A dotted name can refer to a top-level type or a type inside an owner
      // file. Keep all verified declarations across registered roots.
      const ownerPath = requiredOwner ?? name;
      for (let dot = ownerPath.lastIndexOf("."); dot > 0; dot = ownerPath.lastIndexOf(".", dot - 1)) {
        if (lookups.at(-1)?.status === "limit") break;
        const fileOwner = ownerPath.slice(0, dot);
        lookups.push(await this.lookupJava(name, fileOwner, requiredOwner));
      }
    }

    const sources = mergeJavaSourceLookups(lookups);
    if (sources.candidates.length || sources.status === "limit") return sources;

    const binaryKey = ["binary", name, requiredOwner].join("\0");
    let binaryLookup = this.javaLookups.get(binaryKey);
    this.traceCache("binary_lookup", !!binaryLookup, { className: name, requiredOwner }, this.base?.javaLookups.has(binaryKey));
    if (!binaryLookup) {
      binaryLookup = this.session.resolveBinary(name, requiredOwner, this.trace);
      this.javaLookups.set(binaryKey, binaryLookup);
    }
    const binaries = await binaryLookup;
    const complete = sources.complete && binaries.complete;
    if (binaries.status !== "limit" && !binaries.candidates.length &&
      await this.platformType(name) !== "missing" && (!requiredOwner || await this.platformType(requiredOwner) !== "missing")) {
      const platform = platformLookup(name);
      return complete ? platform : { ...sources, status: "blocked", candidates: platform.candidates, complete };
    }
    return {
      ...binaries, complete,
      status: binaries.status === "limit" || sources.status === "missing" ? binaries.status : sources.status,
      diagnostics: [...sources.diagnostics, ...binaries.diagnostics]
    };
  }

  private async exactType(
    name: string, pkg: string, origin: SourceFile, requiredOwner?: string, { inherited = false } = {}
  ): Promise<SourceLookupResult> {
    const lookup = await this.findType(name, requiredOwner);
    const inaccessible = {
      ...lookup, status: "unsupported" as const, complete: false,
      diagnostics: [...lookup.diagnostics, { code: "JAVA_TYPE_ACCESS", message: "The candidate type is not accessible from this use." }]
    };
    if (lookup.status === "binary_only" && lookup.candidates.some(({ rootId }) => rootId === "jdk") &&
      await this.platformType(name) !== "public") return inaccessible;
    const source = this.resolvedSource(lookup);
    if (!source || source.sourceId === origin.sourceId) return lookup;
    const syntax = await this.syntax(source);
    const declaration = syntax.declarations.find(({ className }) => className === name);
    const accessible = declaration?.access === "public" ||
      (declaration?.access === "protected" && inherited) ||
      (syntax.packageName === pkg && (declaration?.access === "package" || declaration?.access === "protected"));
    return accessible ? lookup : inaccessible;
  }

  private async collectType(
    targetId: string,
    type: JavaSyntax["types"][number],
    source: SourceFile,
    imports: ImportEvidence[],
    pkg: string,
    depth: number,
    context?: IncludeContext
  ): Promise<void> {
    this.checkExpansionBudget();
    const location = locateSource(source, type.location);
    const result = await this.traceLookup(targetId, { lookupKind: "java_type", location, expression: type.expression }, async () => {
      if (type.shadowed) {
        if (source.kind === "java" && await this.isPrivateFromOtherTopLevel(type, source)) {
          return {
            lookup: {
              ...emptyLookup("unsupported"),
              diagnostics: [{ code: "JAVA_TYPE_ACCESS", message: "The candidate type is private to a different top-level declaration." }]
            },
            strategy: "lexical"
          };
        }
        return { lookup: emptyLookup("resolved", true), name: type.resolvedName, strategy: "lexical" };
      }
      if (type.role === "qualifier" && !type.resolvedName) {
        // An unbound expression qualifier could be a value. Only report positive
        // declaration evidence for its written qualified spelling.
        return this.probeType(type.expression, source, pkg, "qualified_name");
      }
      const head = type.expression.split(".", 1)[0];
      const inherited = await this.inheritedType(type, source, head, pkg);
      return this.lookupTypeName(type.expression, source, imports, pkg, inherited);
    });
    if (type.shadowed && result.lookup.status === "resolved") {
      this.references.push({
        targetId, kind: "java-type", expression: type.expression, location, context,
        status: "resolved", binding: type.resolvedName ? "verified" : "unresolved", candidates: []
      });
      return;
    }
    if (!type.shadowed && type.role === "qualifier" && !type.resolvedName && !result.lookup.candidates.length) return;
    const { lookup, name, entry } = result;
    await this.recordType(targetId, type.expression, location, lookup, depth, {
      context,
      importLocation: entry ? locateSource(entry.source, entry.entry.location) : undefined,
      verified: type.resolvedName !== undefined && name === type.resolvedName && lookup.complete
    });
  }

  private async isPrivateFromOtherTopLevel(type: JavaSyntax["types"][number], source: SourceFile): Promise<boolean> {
    if (!type.resolvedName) return false;
    const syntax = await this.syntax(source);
    const declaration = syntax.declarations.find(({ className }) => className === type.resolvedName);
    if (declaration?.access !== "private") return false;
    const packageLength = syntax.packageName ? syntax.packageName.length + 1 : 0;
    const firstMember = declaration.className.indexOf(".", packageLength);
    if (firstMember < 0) return false;
    const topLevel = declaration.className.slice(0, firstMember);
    return !type.enclosingTypes.some((owner) => owner === topLevel || owner.startsWith(topLevel + "."));
  }

  private async probeType(
    name: string, source: SourceFile, pkg: string, strategy: string, entry?: ImportEvidence, owner?: string
  ): Promise<TypeLookup> {
    this.trace?.("lookup.probe", { className: name, strategy, requiredOwner: owner });
    const result = { name, entry, strategy, lookup: await this.exactType(name, pkg, source, owner) };
    this.traceDecision("lookup.probe_result", result);
    return result;
  }

  private async lookupTypeName(
    expression: string, source: SourceFile, imports: ImportEvidence[], pkg: string,
    inherited?: TypeLookup
  ): Promise<TypeLookup> {
    const separator = expression.indexOf(".");
    const head = separator < 0 ? expression : expression.slice(0, separator);
    const first = await this.lookupSimpleType(head, source, imports, pkg, inherited);
    const possiblyStatic = (!first.entry || first.entry.entry.wildcard) && !inherited && imports.some(({ entry }) =>
      entry.static && (entry.wildcard || entry.name.split(".").at(-1) === head));
    if (separator < 0) return possiblyStatic ? staticImportUncertain(first) : first;

    // A qualified type name starts with either a visible type or a package.
    // A package spelling is resolved as written, never relative to pkg.
    const owners = [...new Set(first.lookup.candidates.map(({ className }) => className).filter((name): name is string => !!name))];
    const foundOwner = first.lookup.status === "resolved" || first.lookup.status === "binary_only";
    const suffix = expression.slice(separator);
    const memberProbes: TypeLookup[] = [];
    if (foundOwner || first.lookup.status === "ambiguous") {
      for (const owner of owners) {
        memberProbes.push(await this.probeType(owner + suffix, source, pkg, "member_type", first.entry, owner));
      }
    }
    if (foundOwner) {
      const member = selectType(memberProbes);
      return possiblyStatic ? staticImportUncertain(member) : member;
    }
    if (first.lookup.status === "ambiguous") {
      const members = selectType(memberProbes);
      return { lookup: {
        ...members.lookup, status: "ambiguous", complete: false,
        diagnostics: [...first.lookup.diagnostics, ...members.lookup.diagnostics]
      } };
    }
    if (first.entry && !first.entry.entry.wildcard) return first;

    const qualified = await this.probeType(expression, source, pkg, "qualified_name");
    if (isAbsentType(first.lookup)) return possiblyStatic ? staticImportUncertain(qualified) : qualified;
    return {
      ...qualified,
      lookup: {
        ...qualified.lookup,
        status: first.lookup.status === "limit" ? "limit" : "blocked",
        complete: false,
        diagnostics: [...first.lookup.diagnostics, ...qualified.lookup.diagnostics]
      }
    };
  }

  private async lookupSimpleType(
    name: string, source: SourceFile, imports: ImportEvidence[], pkg: string, inherited?: TypeLookup
  ): Promise<TypeLookup> {
    if (inherited && (inherited.lookup.status === "resolved" || inherited.lookup.status === "binary_only" ||
      inherited.lookup.status === "ambiguous")) return inherited;
    const options: TypeLookup[] = inherited ? [inherited] : [];
    const explicit = new Map(imports.filter(({ entry }) => !entry.wildcard && !entry.static &&
      entry.name.split(".").at(-1) === name).map((item) => [item.entry.name, item]));
    if (explicit.size) {
      for (const [qualified, entry] of explicit) options.push(await this.probeType(qualified, source, pkg, "explicit_import", entry));
      return selectType(options, explicit.size > 1);
    }

    const same = await this.probeType(pkg ? pkg + "." + name : name, source, pkg, "same_package");
    options.push(same);
    if (same.lookup.status === "resolved" || same.lookup.status === "binary_only" || same.lookup.status === "ambiguous") {
      return selectType(options);
    }
    const wildcard = new Map<string, ImportEvidence | undefined>([["java.lang", undefined]]);
    if (source.kind === "jsp") {
      for (const prefix of ["javax.servlet", "javax.servlet.http", "javax.servlet.jsp"]) wildcard.set(prefix, undefined);
    }
    for (const item of imports) {
      if (item.entry.wildcard && !item.entry.static) wildcard.set(item.entry.name, item);
    }
    for (const [prefix, entry] of wildcard) {
      options.push(await this.probeType(prefix + "." + name, source, pkg, entry ? "wildcard_import" : "default_import", entry));
    }
    return selectType(options);
  }

  private async inheritedType(
    type: JavaSyntax["types"][number], source: SourceFile, name: string, pkg: string
  ): Promise<TypeLookup | undefined> {
    if (type.inheritanceUncertain) return { lookup: inheritanceUncertain() };
    if (!type.enclosingTypes.length || source.kind !== "java") return undefined;
    const syntax = await this.syntax(source);
    for (const enclosing of type.enclosingTypes) {
      const declaration = syntax.declarations.find(({ className }) => className === enclosing);
      if (!declaration?.superTypes.length) continue;
      const key = source.sourceId + "\0" + enclosing + "\0" + name;
      let lookup = this.inheritedTypes.get(key);
      this.traceCache("inherited_member", !!lookup, { className: enclosing, member: name });
      if (!lookup) {
        lookup = this.lookupInheritedMembers(declaration, source, name, pkg, new Set(), 0);
        this.inheritedTypes.set(key, lookup);
      }
      const result = await lookup;
      if (result) return { ...result, strategy: "inherited_member" };
    }
    return undefined;
  }

  private async lookupInheritedMembers(
    declaration: JavaSyntax["declarations"][number], source: SourceFile, member: string, pkg: string,
    ancestors: ReadonlySet<string>, level: number, samePackagePath = true
  ): Promise<TypeLookup | undefined> {
    this.checkExpansionBudget();
    if (!declaration.superTypes.length) return undefined;
    if (level >= this.maxDepth) {
      return { lookup: {
        ...emptyLookup("limit"), diagnostics: [{ code: "SOURCE_LIMIT", message: "The inherited type lookup exceeds the requested depth." }]
      } };
    }
    const key = source.sourceId + "\0" + declaration.className;
    if (ancestors.has(key)) return { lookup: inheritanceUncertain() };
    const branch = new Set(ancestors).add(key);
    const syntax = await this.syntax(source);
    const imports = syntax.imports.map((entry) => ({ entry, source }));
    const options: TypeLookup[] = [];
    for (const expression of declaration.superTypes) {
      const local = localSupertype(syntax, declaration.className, expression);
      const parent: ParentType | TypeLookup = local
        ? { name: local, source }
        : await this.lookupParent(expression, source, imports, syntax.packageName);
      if ("lookup" in parent) {
        options.push(parent);
        continue;
      }
      const name = parent.name + "." + member;
      if (!parent.source) {
        if (parent.platform) {
          const members = await this.lookupPlatformMembers(parent.name, member);
          if (members !== undefined) {
            for (const memberName of members) options.push({ name: memberName, lookup: platformLookup(memberName) });
            continue;
          }
        }
        const lookup = await this.exactType(name, pkg, source, parent.name, { inherited: true });
        if (!isInaccessibleType(lookup)) {
          options.push({ name, lookup: isAbsentType(lookup) ? inheritanceUncertain() : lookup });
        }
        continue;
      }
      const parentSyntax = await this.syntax(parent.source);
      const memberDeclaration = parentSyntax.declarations.find(({ className }) => className === name);
      const accessiblePackage = samePackagePath && parentSyntax.packageName === pkg;
      if (memberDeclaration) {
        // A private declaration hides ancestors' declarations without being inherited.
        const { access } = memberDeclaration;
        if (access === "public" || access === "protected" || (access === "package" && accessiblePackage)) {
          options.push({ name, lookup: declaredType(parent.source, name) });
        }
        continue;
      }
      const parentDeclaration = parentSyntax.declarations.find(({ className }) => className === parent.name);
      if (!parentDeclaration) {
        options.push({ lookup: inheritanceUncertain() });
        continue;
      }
      const inherited = await this.lookupInheritedMembers(
        parentDeclaration, parent.source, member, pkg, branch, level + 1, accessiblePackage
      );
      if (inherited) options.push(inherited);
    }
    return options.length ? selectType(options) : undefined;
  }

  private async lookupParent(
    expression: string, source: SourceFile, imports: ImportEvidence[], pkg: string
  ): Promise<ParentType | TypeLookup> {
    const { lookup, name } = await this.lookupTypeName(expression, source, imports, pkg);
    if (name && lookup.complete) {
      if (lookup.status === "binary_only") return { name, platform: lookup.candidates.every(({ rootId }) => rootId === "jdk") };
      const parent = this.resolvedSource(lookup);
      if (parent) return { name, source: parent };
    }
    const uncertain = inheritanceUncertain();
    return { lookup: {
      ...uncertain,
      status: lookup.status === "limit" ? "limit" : "unsupported",
      diagnostics: [...uncertain.diagnostics, ...lookup.diagnostics]
    } };
  }

  private lookupPlatformMembers(owner: string, member: string): Promise<string[] | undefined> {
    const key = owner + "\0" + member;
    let lookup = this.platformMembers.get(key);
    this.traceCache("platform_members", !!lookup, { className: owner, member });
    if (!lookup) {
      lookup = this.reader.platformMemberTypes(owner, member).catch((error) => {
        if (this.signal?.aborted) throw error;
        return undefined;
      });
      this.platformMembers.set(key, lookup);
    }
    return lookup;
  }

  private async recordType(
    targetId: string, expression: string, location: EvidenceLocation, lookup: SourceLookupResult, depth: number,
    detail: { context?: IncludeContext; importLocation?: EvidenceLocation; verified?: boolean }
  ): Promise<void> {
    const { status, candidates } = lookup;
    const binding = detail.verified && (status === "resolved" || status === "binary_only")
      ? "verified" : candidates.length ? "candidate" : "unresolved";
    this.references.push({
      targetId, kind: "java-type", expression, location, status, candidates, binding,
      context: detail.context, importLocation: detail.importLocation
    });
    const platformBinary = status === "binary_only" && candidates.every(({ rootId }) => rootId === "jdk");
    if (status !== "resolved" && !platformBinary) this.partial = true;
    if (status === "unsupported" && lookup.diagnostics.length === 0) {
      lookup.diagnostics.push({ code: "JAVA_IMPORT_UNSUPPORTED", message: "The import requires static member type resolution." });
    }
    this.recordDiagnostics(targetId, lookup, location);
    const dependency = this.follow ? this.resolvedSource(lookup) : undefined;
    if (!dependency) return;
    const seen = this.seenJava.get(targetId + "\0" + dependency.sourceId);
    if (seen !== undefined && seen <= depth + 1) {
      this.traceCache("reference_expansion", true, { targetIndex: this.traceTargets.get(targetId), sourceId: dependency.sourceId, kind: "java" });
      return;
    }
    if (depth >= this.maxDepth) this.reportLimit(targetId, "The Java reference exceeds the requested depth.", location);
    else await this.collectJava(targetId, dependency, depth + 1);
  }
}

function lookupReason(lookup: SourceLookupResult, strategy?: string): string {
  switch (lookup.status) {
    case "resolved": return strategy === "lexical" ? "LEXICAL_BINDING" : "UNIQUE_MATCH";
    case "binary_only": return "BINARY_MATCH";
    case "ambiguous": return "SOURCE_AMBIGUOUS";
    case "limit": return "SOURCE_LIMIT";
    case "missing": return "SOURCE_NOT_FOUND";
    case "unsupported":
      if (lookup.diagnostics.some(({ code }) => code === "JAVA_TYPE_ACCESS")) return "JAVA_TYPE_ACCESS";
      if (lookup.diagnostics.some(({ code }) => code === "JAVA_STATIC_IMPORT")) return "JAVA_STATIC_IMPORT";
      return "SOURCE_UNSUPPORTED";
    default:
      return lookup.diagnostics.find(({ code }) => code !== "SOURCE_NOT_FOUND" && code !== "SOURCE_DECLARATION_MISMATCH")?.code ??
        lookup.status.toUpperCase();
  }
}

function isAbsentType(lookup: SourceLookupResult): boolean {
  return lookup.status === "missing" && lookup.complete;
}

function localSupertype(syntax: JavaSyntax, declaringClass: string, expression: string): string | undefined {
  for (let dot = declaringClass.lastIndexOf("."); dot > syntax.packageName.length; dot = declaringClass.lastIndexOf(".", dot - 1)) {
    const scoped = declaringClass.slice(0, dot) + "." + expression;
    if (syntax.declarations.some(({ className }) => className === scoped)) return scoped;
  }
  const qualified = syntax.packageName ? syntax.packageName + "." + expression : expression;
  const explicit = syntax.imports.some(({ name, wildcard, static: isStatic }) =>
    !wildcard && !isStatic && name.split(".").at(-1) === expression);
  return !explicit && syntax.declarations.some(({ className }) => className === qualified) ? qualified : undefined;
}

function declaredType(source: SourceFile, className: string): SourceLookupResult {
  const { rootId, path, sourceId, sourceHash } = source;
  return {
    ...emptyLookup("resolved", true),
    candidates: [{ className, rootId, path, sourceId, sourceHash }]
  };
}

function isInaccessibleType(lookup: SourceLookupResult): boolean {
  return lookup.status === "unsupported" && lookup.diagnostics.some(({ code }) => code === "JAVA_TYPE_ACCESS");
}

function selectType(probes: TypeLookup[], forceAmbiguous = false): TypeLookup {
  const found = probes.filter(({ lookup }) => lookup.status === "resolved" || lookup.status === "binary_only");
  const active = found.length ? probes.filter(({ lookup }) => !isInaccessibleType(lookup)) : probes;
  const viable = active.filter(({ lookup }) => !isAbsentType(lookup));
  const candidates = new Map(active.flatMap(({ lookup }) => lookup.candidates.map((candidate) =>
    [(candidate.sourceId ?? candidate.rootId + "\0" + candidate.path) + "\0" + candidate.className, candidate] as const)));
  const complete = active.every(({ lookup }) => lookup.complete);
  const best = found.length === 1 ? found[0] : viable.length === 1 ? viable[0] : undefined;
  const competingNames = new Set(found.map(({ name }) => name));
  const ambiguous = forceAmbiguous || competingNames.size > 1 || active.some(({ lookup }) => lookup.status === "ambiguous");
  const limited = active.some(({ lookup }) => lookup.status === "limit");
  const fallback = best?.lookup.status ?? viable.find(({ lookup }) => lookup.status === "blocked")?.lookup.status ??
    viable.find(({ lookup }) => lookup.status === "unsupported")?.lookup.status ?? "missing";
  const status = ambiguous ? "ambiguous" : limited ? "limit" :
    !complete && found.length ? "blocked" : fallback;
  const diagnostics = (status === "missing" ? active : viable).flatMap(({ lookup }) => lookup.diagnostics);
  if (ambiguous) diagnostics.push({ code: "SOURCE_AMBIGUOUS", message: "Multiple types are visible for this name." });
  const origin = best ?? (active.length === 1 ? active[0] : found[0]);
  return { ...origin, lookup: { status, candidates: [...candidates.values()], complete, diagnostics } };
}

function inheritanceUncertain(): SourceLookupResult {
  return {
    ...emptyLookup("unsupported"),
    diagnostics: [{ code: "JAVA_INHERITANCE_UNRESOLVED", message: "The inherited member types could not be determined." }]
  };
}

function staticImportUncertain(result: TypeLookup): TypeLookup {
  if (result.lookup.status === "limit" || result.lookup.status === "ambiguous") return result;
  return {
    ...result,
    lookup: {
      ...result.lookup, status: "unsupported", complete: false,
      diagnostics: [...result.lookup.diagnostics, { code: "JAVA_STATIC_IMPORT", message: "A static import may affect the type binding." }]
    }
  };
}

function mergeJavaSourceLookups(lookups: SourceLookupResult[]): SourceLookupResult {
  const candidates = [...new Map(lookups.flatMap((lookup) => lookup.candidates.map((candidate) => [
    candidate.sourceId, candidate
  ]))).values()];
  const complete = lookups.every((lookup) => lookup.complete);
  const diagnostics = lookups.flatMap((lookup) =>
    candidates.length && lookup.status === "missing" && lookup.complete ? [] : lookup.diagnostics
  );
  if (candidates.length > 1) {
    if (!diagnostics.some(({ code }) => code === "SOURCE_AMBIGUOUS")) {
      diagnostics.push({ code: "SOURCE_AMBIGUOUS", message: "Distinct files declare the requested Java type", needed: "An explicit javaMap entry" });
    }
    return { status: "ambiguous", complete, candidates, diagnostics };
  }
  if (lookups.some(({ status }) => status === "limit")) return { status: "limit", complete, candidates, diagnostics };
  if (!complete) return { status: "blocked", complete, candidates, diagnostics };
  return { status: candidates.length ? "resolved" : "missing", complete, candidates, diagnostics };
}

function platformLookup(name: string): SourceLookupResult {
  return { ...emptyLookup("binary_only", true), candidates: [{ className: name, rootId: "jdk", path: name.replace(/\./g, "/") + ".class" }] };
}

async function frozenLookups(lookups: Map<string, Promise<SourceLookupResult>>) {
  const frozen = new Map<string, Promise<SourceLookupResult>>();
  for (const [key, promise] of lookups) {
    const lookup = await promise.catch(() => undefined);
    if (lookup && lookup.status !== "limit") frozen.set(key, Promise.resolve(lookup));
  }
  return frozen;
}
