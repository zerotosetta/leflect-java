import { createHash } from "crypto";
import { constants } from "fs";
import fs from "fs/promises";
import path from "path";
import type { LeflectConfig, SourceResolutionLimits } from "@leflect-java/schema";

import { SourceClasspath } from "./source-classpath";
import type { SourceCandidate, SourceDiagnostic, SourceKind, SourceStatus } from "./source-contract";
export { SourceClasspath, SourceClasspathError } from "./source-classpath";
export type { SourceCandidate, SourceDiagnostic } from "./source-contract";

export const sourceResolutionDefaults: Readonly<SourceResolutionLimits> = Object.freeze({
  maxDepth: 16,
  maxFiles: 400,
  maxProbes: 4000,
  maxFileBytes: 1048576,
  maxTotalSourceBytes: 33554432,
  maxResponseBytes: 16384,
  timeoutMs: 90000
});

export type SourceFile = {
  sourceId: string;
  sourceHash: string;
  rootId: string;
  path: string;
  kind: SourceKind;
  encoding: string;
  text: string;
  bytes: Buffer;
  realPath: string;
};

export type SourceLookupResult = {
  status: SourceStatus;
  candidates: SourceCandidate[];
  diagnostics: SourceDiagnostic[];
  complete: boolean;
};

type RootDefinition = { rootId: string; directory: string };
type Root = RootDefinition & { realPath?: string; diagnostic: SourceDiagnostic };
type Attempt = SourceCandidate & { absolutePath: string; mapped: boolean; root?: Root };
type LookupSessionOptions = { signal?: AbortSignal; baseSources?: Iterable<SourceFile>; baseClasspath?: SourceClasspath };
type DeclarationVerifier = (source: SourceFile, className: string) => boolean | Promise<boolean>;

export class SourceWorkspace {
  readonly limits: SourceResolutionLimits;
  readonly roots: readonly RootDefinition[];
  readonly javaMap: ReadonlyMap<string, string>;
  readonly sourceMap: ReadonlyMap<string, string>;

  constructor(readonly config: LeflectConfig) {
    const resolution = config.sourceResolution;
    this.limits = { ...sourceResolutionDefaults, ...resolution?.limits };
    const webRoot = resolution?.webRoot ?? config.jsp?.webappRoot ?? ".";
    const javaRoots = resolution?.javaRoots ?? ["."];
    this.roots = [
      { rootId: "web", directory: path.resolve(config.root, webRoot) },
      ...javaRoots.map((directory, index) => ({
        rootId: `java-${index + 1}`, directory: path.resolve(config.root, directory)
      }))
    ];
    this.javaMap = new Map(Object.entries(resolution?.javaMap ?? {}));
    this.sourceMap = new Map(Object.entries(resolution?.sourceMap ?? {}).map(([key, value]) => {
      const logicalPath = normalizeJspPath(key);
      if (!logicalPath) throw new Error(`Invalid JSP path in sourceMap: ${key}`);
      return [logicalPath, value];
    }));
  }

  start(options: LookupSessionOptions = {}): SourceLookupSession {
    return new SourceLookupSession(this, options);
  }
}

export class SourceLookupSession {
  readonly sources = new Map<string, SourceFile>();
  readonly signal: AbortSignal;
  probes = 0;
  totalSourceBytes = 0;

  private readonly byRealPath = new Map<string, SourceFile>();
  private inspectedFiles = 0;
  private inspectedBytes = 0;
  private rootStates?: Promise<Root[]>;
  private classpath?: Promise<SourceClasspath>;

  constructor(readonly workspace: SourceWorkspace, options: LookupSessionOptions = {}) {
    const timeout = AbortSignal.timeout(Math.min(workspace.limits.timeoutMs, 2_147_483_647));
    this.signal = options.signal ? combineSignals(options.signal, timeout) : timeout;
    if (options.baseClasspath) this.classpath = Promise.resolve(options.baseClasspath);
    for (const source of options.baseSources ?? []) this.remember(source);
    this.inspectedFiles = this.sources.size;
    this.inspectedBytes = this.totalSourceBytes;
  }

  async getRootDiagnostics(): Promise<SourceDiagnostic[]> {
    return (await this.getRoots()).map((root) => root.diagnostic);
  }

  pinClasspath(): Promise<SourceClasspath> {
    return this.classpath ??= SourceClasspath.capture(this.workspace.config, this.signal);
  }

  async resolveJsp(input: string): Promise<SourceLookupResult> {
    const logicalPath = normalizeJspPath(input);
    if (!logicalPath) return failure("blocked", "SOURCE_BOUNDARY", "Invalid JSP logical path");
    const roots = await this.getRoots();
    const mapped = this.workspace.sourceMap.get(logicalPath);
    const web = roots[0];
    const attempts = [mapped === undefined
      ? rootAttempt(web, logicalPath.slice(1), { logicalPath })
      : this.mapAttempt(mapped, { logicalPath }, roots, "web-map")];
    return this.inspect("jsp", attempts);
  }

  async resolveJava(
    className: string,
    verify?: DeclarationVerifier,
    ownerClassName = className
  ): Promise<SourceLookupResult> {
    if (!isJavaClassName(className) || !isJavaClassName(ownerClassName) ||
      (ownerClassName !== className && !className.startsWith(`${ownerClassName}.`))) {
      return failure("unsupported", "SOURCE_JAVA_NAME", "Invalid Java class name");
    }
    const roots = await this.getRoots();
    const mapped = this.workspace.javaMap.get(className);
    const javaPath = `${ownerClassName.replace(/\./g, "/")}.java`;
    const attempts = mapped === undefined
      ? roots.slice(1).map((root) => rootAttempt(root, javaPath, { className }))
      : [this.mapAttempt(mapped, { className }, roots, "java-map")];
    const sources = await this.inspect("java", attempts, verify && ((source) => verify(source, className)));
    if (sources.status !== "missing" && (sources.status !== "blocked" || sources.candidates.length)) return sources;

    const classpath = await this.pinClasspath();
    const binaries = classpath.find(className, () => this.consumeProbe(), this.signal);
    const diagnostics = [...sources.diagnostics, ...classpath.diagnostics, ...binaries.diagnostics];
    if (binaries.limited) return { status: "limit", candidates: binaries.candidates, diagnostics, complete: false };
    if (sources.status === "blocked") return { ...sources, candidates: binaries.candidates, diagnostics };
    if (binaries.candidates.length) {
      return {
        status: "binary_only", candidates: binaries.candidates, diagnostics,
        complete: classpath.diagnostics.length === 0 && !binaries.diagnostics.length
      };
    }
    if (classpath.diagnostics.length > 0) return { ...sources, diagnostics, complete: false };
    return { ...sources, diagnostics };
  }

  private getRoots(): Promise<Root[]> {
    return this.rootStates ??= Promise.all(this.workspace.roots.map(async (root) => {
      const relative = path.relative(this.workspace.config.root, root.directory);
      const displayPath = pathInside(this.workspace.config.root, root.directory) ? toPosix(relative) || "." : ".";
      try {
        const realPath = await fs.realpath(root.directory);
        if (!(await fs.stat(realPath)).isDirectory()) throw new Error("Not a directory");
        await fs.access(realPath, constants.R_OK | constants.X_OK);
        return { ...root, realPath, diagnostic: {
          code: "SOURCE_ROOT_READY", message: "Configured source root is accessible", rootId: root.rootId, path: displayPath
        } };
      } catch {
        return { ...root, diagnostic: {
          code: "SOURCE_ROOT_UNAVAILABLE", message: "Configured source root is missing or inaccessible",
          rootId: root.rootId, path: displayPath, needed: "An accessible configured source root"
        } };
      }
    }));
  }

  private mapAttempt(
    mapped: string, logical: Pick<SourceCandidate, "className" | "logicalPath">, roots: Root[], mappingId: string
  ): Attempt {
    const absolutePath = path.resolve(this.workspace.config.root, mapped);
    const relevantRoots = mappingId === "java-map" ? roots.slice(1) : roots.slice(0, 1);
    const root = relevantRoots.find((item) => pathInside(item.directory, absolutePath));
    return {
      ...logical,
      rootId: root?.rootId ?? mappingId,
      path: root ? toPosix(path.relative(root.directory, absolutePath)) : path.basename(absolutePath),
      absolutePath,
      mapped: true,
      root
    };
  }

  private async inspect(
    kind: SourceKind, attempts: Attempt[], verify?: (source: SourceFile) => boolean | Promise<boolean>
  ): Promise<SourceLookupResult> {
    const diagnostics: SourceDiagnostic[] = [];
    const candidates = new Map<string, SourceCandidate>();
    const incompleteCandidates: SourceCandidate[] = [];
    let blocked = false;
    let limited = false;
    let unsupported = false;

    for (const attempt of attempts) {
      if (!this.consumeProbe()) {
        limited = true;
        diagnostics.push(this.limitDiagnostic(attempt));
        break;
      }
      try {
        const source = await this.readSource(kind, attempt);
        this.signal.throwIfAborted();
        if (kind === "java" && !verify) {
          unsupported = true;
          incompleteCandidates.push(candidateMetadata(attempt));
          diagnostics.push(attemptDiagnostic(attempt, "SOURCE_DECLARATION_UNVERIFIED", "Java declaration could not be verified"));
          continue;
        }
        if (verify) {
          const declaresType = await verify(source);
          this.signal.throwIfAborted();
          if (!declaresType) {
            diagnostics.push(attemptDiagnostic(attempt, "SOURCE_DECLARATION_MISMATCH", "File does not declare the requested Java type"));
            continue;
          }
        }
        this.remember(source);
        if (!candidates.has(source.sourceId)) {
          candidates.set(source.sourceId, { ...candidateMetadata(attempt), sourceId: source.sourceId, sourceHash: source.sourceHash });
        }
      } catch (error) {
        const code = errorCode(error);
        if (this.signal.aborted) {
          limited = true;
          diagnostics.push(this.limitDiagnostic(attempt));
          break;
        }
        if (code === "SOURCE_LIMIT") {
          limited = true;
          diagnostics.push(attemptDiagnostic(attempt, code, "Source exceeds the configured collection limits"));
        } else if (isMissing(error)) {
          diagnostics.push(attemptDiagnostic(attempt, "SOURCE_NOT_FOUND", "No source file at the candidate path"));
        } else {
          blocked = true;
          const diagnosticCode = code?.startsWith("SOURCE_") ? code : "SOURCE_ACCESS";
          const message = error instanceof SourceReadError ? error.message : "Source candidate could not be inspected";
          diagnostics.push(attemptDiagnostic(attempt, diagnosticCode, message));
        }
      }
    }

    if (!attempts.length) diagnostics.push({ code: "SOURCE_NOT_FOUND", message: "No source roots configured for the target" });
    if (candidates.size > 1) {
      diagnostics.push({ code: "SOURCE_AMBIGUOUS", message: "Distinct files declare the requested Java type", needed: "An explicit javaMap entry" });
    }
    const complete = !blocked && !limited && !unsupported;
    const status = candidates.size > 1 ? "ambiguous" : limited ? "limit" : blocked ? "blocked" :
      unsupported ? "unsupported" : candidates.size === 1 ? "resolved" : "missing";
    return { status, complete, candidates: [...candidates.values(), ...incompleteCandidates], diagnostics };
  }

  private async readSource(kind: SourceKind, attempt: Attempt): Promise<SourceFile> {
    const direct = this.byRealPath.get(attempt.absolutePath);
    if (direct) return direct;

    if (!attempt.mapped && !attempt.root?.realPath) {
      throw new SourceReadError("SOURCE_ROOT_UNAVAILABLE", "Configured source root is missing or inaccessible");
    }
    let realPath: string;
    try {
      realPath = await fs.realpath(attempt.absolutePath);
    } catch (error) {
      if (!attempt.mapped && attempt.root?.realPath && isMissing(error)) {
        await checkMissingPathBoundary(attempt.absolutePath, attempt.root);
      }
      throw error;
    }
    if (!(await this.allows(attempt, realPath))) {
      throw new SourceReadError("SOURCE_BOUNDARY", "Candidate resolves outside the configured source boundary");
    }
    const previous = this.byRealPath.get(realPath);
    if (previous) return previous;

    const limits = this.workspace.limits;
    const stats = await fs.stat(realPath);
    if (!stats.isFile()) throw new SourceReadError("SOURCE_ACCESS", "Source candidate is not a regular file");
    if (this.inspectedFiles >= limits.maxFiles || stats.size > limits.maxFileBytes ||
      this.inspectedBytes + stats.size > limits.maxTotalSourceBytes) {
      throw new SourceReadError("SOURCE_LIMIT", "Source exceeds the configured collection limits");
    }

    const handle = await fs.open(realPath, "r");
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size ||
        await fs.realpath(attempt.absolutePath) !== realPath) {
        throw new SourceReadError("SOURCE_CHANGED", "Source changed while opening the candidate");
      }
      const bytes = Buffer.alloc(opened.size);
      this.inspectedFiles += 1;
      this.inspectedBytes += opened.size;
      for (let read = 0; read < bytes.length;) {
        this.signal.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, read, bytes.length - read, read);
        if (!bytesRead) throw new SourceReadError("SOURCE_CHANGED", "Source size changed during collection");
        read += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        throw new SourceReadError("SOURCE_CHANGED", "Source bytes changed during collection");
      }

      const overrides = this.workspace.config.sourceResolution?.encodingOverrides;
      const label = ownValue(overrides, `${attempt.rootId}/${attempt.path}`) ?? this.workspace.config.sourceResolution?.encoding ?? "utf-8";
      let decoded: string;
      let encoding: string;
      try {
        const decoder = new TextDecoder(label, { fatal: true });
        decoded = decoder.decode(bytes);
        encoding = decoder.encoding;
      } catch {
        throw new SourceReadError("SOURCE_ENCODING", `Source cannot be decoded with encoding ${label}`);
      }

      const sourceHash = createHash("sha256").update(bytes).digest("hex");
      const sourceId = `src-${createHash("sha256").update(realPath).update("\0").update(sourceHash).digest("hex")}`;
      return { sourceId, sourceHash, kind, rootId: attempt.rootId, path: attempt.path, realPath, text: decoded, encoding, bytes };
    } finally {
      await handle.close();
    }
  }

  private async allows(attempt: Attempt, realPath: string): Promise<boolean> {
    if (!attempt.mapped) return Boolean(attempt.root?.realPath && realPathInside(attempt.root.realPath, realPath));
    if (attempt.absolutePath === realPath) return true;
    if ((await this.getRoots()).some((root) => root.realPath && realPathInside(root.realPath, realPath))) return true;
    return process.platform === "win32" && attempt.absolutePath.toLowerCase() === realPath.toLowerCase() &&
      await hasNoPathLinks(attempt.absolutePath);
  }

  private remember(source: SourceFile): void {
    if (this.sources.has(source.sourceId)) return;
    this.sources.set(source.sourceId, source);
    this.byRealPath.set(source.realPath, source);
    this.totalSourceBytes += source.bytes.length;
  }

  private consumeProbe(): boolean {
    if (this.signal.aborted || this.probes >= this.workspace.limits.maxProbes) return false;
    this.probes += 1;
    return true;
  }

  private limitDiagnostic(attempt: Attempt): SourceDiagnostic {
    return attemptDiagnostic(attempt, "SOURCE_LIMIT", this.signal.aborted
      ? "Source collection timed out or was canceled" : "Candidate probe limit reached");
  }
}

export function normalizeJspPath(value: string, containingPath?: string): string | undefined {
  if (!value || value.startsWith("//") || /[\\:\p{Cc}]/u.test(value)) return undefined;
  const parts = containingPath && !value.startsWith("/")
    ? path.posix.dirname(containingPath).split("/").filter(Boolean) : [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length ? `/${parts.join("/")}` : undefined;
}

export function isJavaClassName(value: string): boolean {
  const identifier = /^[\p{ID_Start}\p{Sc}\p{Pc}][\p{ID_Continue}\p{Sc}\p{Pc}]*$/u;
  return value.split(".").every((part) => identifier.test(part));
}

function rootAttempt(
  root: Root, relative: string, logical: Pick<SourceCandidate, "className" | "logicalPath">
): Attempt {
  return { ...logical, rootId: root.rootId, path: relative, absolutePath: path.join(root.directory, relative), mapped: false, root };
}

function candidateMetadata(attempt: Attempt): SourceCandidate {
  return { rootId: attempt.rootId, path: attempt.path, className: attempt.className, logicalPath: attempt.logicalPath };
}

const neededByCode = new Map([
  ["SOURCE_NOT_FOUND", "A source file at the candidate path or an explicit mapping"],
  ["SOURCE_ENCODING", "The file's original encoding"],
  ["SOURCE_ROOT_UNAVAILABLE", "An accessible configured source root"],
  ["SOURCE_BOUNDARY", "A file within the configured source boundary"],
  ["SOURCE_CHANGED", "A stable version of the source file"]
]);

function attemptDiagnostic(attempt: Attempt, code: string, message: string): SourceDiagnostic {
  const needed = neededByCode.get(code);
  return { code, message, rootId: attempt.rootId, path: attempt.path, ...(needed && { needed }) };
}

function failure(status: SourceStatus, code: string, message: string): SourceLookupResult {
  return { status, candidates: [], diagnostics: [{ code, message }], complete: false };
}

function ownValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function realPathInside(root: string, candidate: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || candidate.startsWith(prefix);
}

async function hasNoPathLinks(absolutePath: string): Promise<boolean> {
  for (let current = absolutePath; ; current = path.dirname(current)) {
    if ((await fs.lstat(current)).isSymbolicLink()) return false;
    if (path.dirname(current) === current) return true;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

async function checkMissingPathBoundary(candidate: string, root: Root): Promise<void> {
  const boundary = root.realPath!;
  // A nonexistent target can still sit beneath a link outside the source root.
  for (let current = candidate; ; current = path.dirname(current)) {
    if (!pathInside(root.directory, current)) return;
    try {
      const realPath = await fs.realpath(current);
      if (realPathInside(boundary, realPath)) return;
      throw new SourceReadError("SOURCE_BOUNDARY", "Candidate resolves outside the configured source boundary");
    } catch (error) {
      if (!isMissing(error)) throw error;
      const link = await fs.readlink(current).catch((readError: unknown) => {
        if (isMissing(readError) || errorCode(readError) === "EINVAL" || errorCode(readError) === "UNKNOWN") return undefined;
        throw readError;
      });
      if (link !== undefined) {
        const parent = await fs.realpath(path.dirname(current));
        if (!realPathInside(boundary, path.resolve(parent, link))) {
          throw new SourceReadError("SOURCE_BOUNDARY", "Candidate resolves outside the configured source boundary");
        }
      }
    }
    if (current === root.directory || path.dirname(current) === current) return;
  }
}

function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted) return first;
  if (second.aborted) return second;
  const controller = new AbortController();
  function abort(event: Event): void {
    const signal = event.target as AbortSignal;
    controller.abort(signal.reason);
    first.removeEventListener("abort", abort);
    second.removeEventListener("abort", abort);
  }
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

class SourceReadError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
