import { randomUUID } from "node:crypto";

import type { LeflectConfig } from "@leflect-java/schema";

import type {
  EvidenceLocation, IncludeContext, ReferenceResult, ResolutionDiagnostic, ResolveReferencesRequest, ResolveReferencesResult,
  SourceDescriptor, SourceResolutionApi, SourceTarget, TargetResult
} from "./source-contract";
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
  normalizeJspPath,
  type SourceClasspath,
  type SourceFile,
  type SourceLookupResult,
  type SourceLookupSession
} from "./source-workspace";

type ImportEvidence = { entry: SyntaxImport; source: SourceFile };
type JspPart = JspJavaPart & { source: SourceFile; context: IncludeContext };
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

  async resolveReferences(request: ResolveReferencesRequest, signal?: AbortSignal): Promise<ResolveReferencesResult> {
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
    const classpath = await session.pinClasspath();
    const resolution = new ReferenceCollector(this.config, session, maxDepth, request.scope?.followReferences ?? false, session.signal, base);
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
  private readonly platformTypes = new Map<string, Promise<boolean>>();
  private readonly seenJava = new Map<string, number>();
  private readonly seenPages = new Map<string, number>();
  private steps = 0;

  constructor(
    config: LeflectConfig,
    private readonly session: SourceLookupSession,
    private readonly maxDepth: number,
    private readonly follow: boolean,
    private readonly signal?: AbortSignal,
    private readonly base?: SourceSnapshot
  ) {
    this.reader = createSourceSyntaxReader(config, { signal });
    this.jspPaths = new Map(base?.jspPaths);
    this.jspUnits = new Map(base?.jspUnits);
    this.javaDeclarations = new Map(base?.javaDeclarations);
    this.javaLookups = new Map(base?.javaLookups);
    this.jspLookups = new Map(base?.jspLookups);
  }

  async close(): Promise<void> {
    await this.reader.close();
  }

  async collect(targets: SourceTarget[]): Promise<void> {
    const rootsDiagnostics = await this.session.getRootDiagnostics();
    this.diagnostics.push(...rootsDiagnostics);
    if (rootsDiagnostics.some(({ code }) => code !== "SOURCE_ROOT_READY")) this.partial = true;
    const roots: { target: SourceTarget; source?: SourceFile }[] = [];
    for (const target of targets) {
      let lookup: SourceLookupResult;
      try {
        this.signal?.throwIfAborted();
        lookup = await this.lookupTarget(target);
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
    if (!source) {
      return Promise.resolve({
        ...emptyLookup("missing"),
        diagnostics: [{ code: "SOURCE_NOT_FOUND", message: "The source ID was not issued by the base snapshot." }]
      });
    }
    return Promise.resolve({ ...emptyLookup("resolved", true), candidates: [describeSource(source)] });
  }

  private lookupJsp(logical: string): Promise<SourceLookupResult> {
    logical = normalizeJspPath(logical) ?? logical;
    let lookup = this.jspLookups.get(logical);
    if (!lookup) {
      lookup = this.session.resolveJsp(logical);
      this.jspLookups.set(logical, lookup);
    }
    return lookup;
  }

  private syntax(source: SourceFile): Promise<JavaSyntax> {
    let syntax = this.javaSyntax.get(source.sourceId);
    if (!syntax) {
      syntax = this.reader.java(source.text).then((parsed) => {
        this.javaDeclarations.set(source.sourceId, parsed.declarations);
        return parsed;
      });
      this.javaSyntax.set(source.sourceId, syntax);
    }
    return syntax;
  }

  private lookupJava(className: string, owner?: string): Promise<SourceLookupResult> {
    const key = owner ? className + "\0" + owner : className;
    let lookup = this.javaLookups.get(key);
    if (!lookup) {
      lookup = this.session.resolveJava(className, async (source, name) => {
        const syntax = await this.syntax(source);
        return syntax.declarations.some((declaration) => declaration.className === name);
      }, owner);
      this.javaLookups.set(key, lookup);
    }
    return lookup;
  }

  private platformType(name: string): Promise<boolean> {
    let result = this.platformTypes.get(name);
    if (!result) {
      result = this.reader.isPlatformType(name).catch((error) => {
        if (this.signal?.aborted) throw error;
        return false;
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
    if (lookup.status === "limit") this.unprocessed.add(targetId);
    this.diagnostics.push(...lookup.diagnostics.map((diagnostic) => ({ ...diagnostic, targetId, location })));
  }

  private async collectJava(targetId: string, source: SourceFile, depth: number): Promise<void> {
    const key = targetId + "\0" + source.sourceId;
    if ((this.seenJava.get(key) ?? Infinity) <= depth) return;
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
    if ((this.seenPages.get(key) ?? Infinity) <= depth) return;
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
      const lookup = include.dynamic
        ? emptyLookup("dynamic")
        : includePath ? await this.lookupJsp(includePath) : emptyLookup("blocked");
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
      const lookup = entry.static ? emptyLookup("unsupported") : await this.exactType(entry.name, pkg, source);
      await this.recordType(targetId, entry.name, location, lookup, depth, { importLocation: location, context });
    }
  }

  private async findType(name: string): Promise<SourceLookupResult> {
    let lookup = await this.lookupJava(name);
    if ((lookup.status === "missing" || lookup.status === "blocked") && !lookup.candidates.length && await this.platformType(name)) {
      const platform = platformLookup(name);
      return lookup.complete ? platform : { ...lookup, candidates: platform.candidates };
    }
    // A nested type lives in its top-level owner's compilation unit.
    // Validate the requested declaration before accepting the owner file.
    for (let dot = name.lastIndexOf("."); lookup.status === "missing" && lookup.complete && dot > 0; dot = name.lastIndexOf(".", dot - 1)) {
      lookup = await this.lookupJava(name, name.slice(0, dot));
    }
    return lookup;
  }

  private async exactType(name: string, pkg: string, origin: SourceFile): Promise<SourceLookupResult> {
    const lookup = await this.findType(name);
    const source = this.resolvedSource(lookup);
    if (!source || source.sourceId === origin.sourceId) return lookup;
    const syntax = await this.syntax(source);
    const declaration = syntax.declarations.find(({ className }) => className === name);
    if (declaration?.access === "private" || (syntax.packageName !== pkg && declaration?.access !== "public")) {
      return {
        ...lookup, status: "unsupported", complete: false,
        diagnostics: [...lookup.diagnostics, { code: "JAVA_TYPE_ACCESS", message: "The candidate type is not public in a different package." }]
      };
    }
    return lookup;
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
    if (type.shadowed) {
      this.references.push({
        targetId, kind: "java-type", expression: type.expression, location, context,
        status: "resolved", binding: type.resolvedName ? "verified" : "unresolved", candidates: []
      });
      return;
    }
    const [head, ...members] = type.expression.split(".");
    const explicit = imports.filter(({ entry }) => !entry.wildcard && !entry.static && entry.name.split(".").at(-1) === head);
    const suffix = members.length ? "." + members.join(".") : "";
    const probe = async (name: string, entry?: ImportEvidence) => ({
      name, entry, lookup: await this.exactType(name, pkg, source)
    });
    type Probe = Awaited<ReturnType<typeof probe>>;
    const uniqueProbes = async (names: Map<string, ImportEvidence | undefined>): Promise<Probe[]> => {
      const results = [];
      for (const [name, entry] of names) results.push(await probe(name, entry));
      return results;
    };
    let options: Probe[];
    if (type.role === "qualifier" && !type.resolvedName) {
      const exact = await probe(type.expression);
      if (!exact.lookup.candidates.length) return;
      options = [exact];
    } else if (explicit.length) {
      options = await uniqueProbes(new Map(explicit.map((item) => [item.entry.name + suffix, item])));
    } else if (members.length && type.resolvedName === type.expression) {
      options = [await probe(type.expression)];
    } else {
      const same = await probe(pkg ? pkg + "." + type.expression : type.expression);
      if (same.lookup.status === "resolved" || same.lookup.status === "binary_only" || same.lookup.status === "ambiguous") {
        options = [same];
      } else {
        const wildcard = new Map<string, ImportEvidence | undefined>([["java.lang." + type.expression, undefined]]);
        if (members.length && pkg) wildcard.set(type.expression, undefined);
        if (source.kind === "jsp") {
          for (const prefix of ["javax.servlet", "javax.servlet.http", "javax.servlet.jsp"]) {
            wildcard.set(prefix + "." + type.expression, undefined);
          }
        }
        for (const item of imports) {
          if (item.entry.wildcard && !item.entry.static) wildcard.set(item.entry.name + "." + type.expression, item);
        }
        options = [same, ...await uniqueProbes(wildcard)];
      }
    }
    const viable = options.filter(({ lookup }) => lookup.status !== "missing");
    const candidates = options.flatMap(({ lookup }) => lookup.candidates);
    const complete = options.every(({ lookup }) => lookup.complete);
    const found = viable.filter(({ lookup }) => lookup.status === "resolved" || lookup.status === "binary_only");
    const best = found.length === 1 ? found[0] : viable.length === 1 ? viable[0] : undefined;
    const ambiguity = found.length > 1 || viable.some(({ lookup }) => lookup.status === "ambiguous") || explicit.length > 1 && options.length > 1;
    const status = ambiguity ? "ambiguous" : best ? best.lookup.status : viable[0]?.lookup.status ?? "missing";
    if (type.role === "qualifier" && status === "missing" && !type.resolvedName && !explicit.length) return;
    const lookup: SourceLookupResult = {
      status: (status === "resolved" || status === "binary_only") && !complete ? "blocked" : status,
      candidates, complete,
      diagnostics: options.flatMap(({ lookup }) => (status !== "missing" && lookup.status === "missing" && lookup.complete) ? [] : lookup.diagnostics)
    };
    if (ambiguity) lookup.diagnostics.push({ code: "SOURCE_AMBIGUOUS", message: "Multiple types are visible for this name." });
    if (imports.some(({ entry }) => entry.static) && !explicit.length && !type.resolvedName) {
      lookup.status = "unsupported";
      lookup.complete = false;
      lookup.diagnostics.push({ code: "JAVA_STATIC_IMPORT", message: "A static import may affect the type binding." });
    }
    await this.recordType(targetId, type.expression, location, lookup, depth, {
      context,
      importLocation: best?.entry ? locateSource(best.entry.source, best.entry.entry.location) : undefined,
      verified: type.resolvedName !== undefined && best?.name === type.resolvedName && complete
    });
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
    if (seen !== undefined && seen <= depth + 1) return;
    if (depth >= this.maxDepth) this.reportLimit(targetId, "The Java reference exceeds the requested depth.", location);
    else await this.collectJava(targetId, dependency, depth + 1);
  }
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
