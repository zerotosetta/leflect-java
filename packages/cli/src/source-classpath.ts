import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";

import AdmZip from "adm-zip";
import type { LeflectConfig } from "@leflect-java/schema";
import type { SourceCandidate, SourceDiagnostic } from "./source-workspace";

type FileVersion = { path: string; hash: string };
type Archive = { kind: "archive"; file: FileVersion; name: string; classes: ReadonlySet<string> };
type ClassesDirectory = { kind: "directory"; directory: string; files: ReadonlyMap<string, string> };
type Entry = { rootId: string; content?: Archive | ClassesDirectory };

export class SourceClasspathError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export class SourceClasspath {
  private constructor(private readonly entries: readonly Entry[], readonly diagnostics: readonly SourceDiagnostic[]) {}

  static async capture(config: LeflectConfig, signal: AbortSignal): Promise<SourceClasspath> {
    const entries: Entry[] = [];
    const diagnostics: SourceDiagnostic[] = [];
    const seen = new Set<string>();
    for (const [index, configuredPath] of (config.java?.classpath ?? []).entries()) {
      const rootId = `classpath-${index + 1}`;
      try {
        signal.throwIfAborted();
        const realPath = await fs.realpath(path.resolve(config.root, configuredPath));
        if (seen.has(realPath)) {
          entries.push({ rootId });
          continue;
        }
        const stat = await fs.stat(realPath);
        let content: Archive | ClassesDirectory;
        if (stat.isDirectory()) {
          const { files, skippedLinks } = await captureClasses(realPath, signal);
          content = { kind: "directory", directory: realPath, files };
          if (skippedLinks) diagnostics.push({
            code: "SOURCE_CLASSPATH_LINK", message: "Links inside the classpath directory were skipped",
            rootId, path: ".", needed: "Explicit classpath entries for linked class files"
          });
        } else if (stat.isFile() && /\.jar$/i.test(configuredPath)) {
          const bytes = await fs.readFile(realPath, { signal });
          const zip = new AdmZip(bytes);
          const classes = new Set(zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.endsWith(".class"))
            .map((entry) => entry.entryName));
          content = { kind: "archive", file: { path: realPath, hash: sha256(bytes) }, name: path.basename(configuredPath), classes };
        } else {
          throw new Error("Unsupported configured classpath entry");
        }
        entries.push({ rootId, content });
        seen.add(realPath);
      } catch {
        entries.push({ rootId });
        diagnostics.push({
          code: signal.aborted ? "SOURCE_LIMIT" : "SOURCE_CLASSPATH",
          message: signal.aborted ? "Classpath collection timed out or was canceled" : "Configured classpath could not be captured",
          rootId, path: ".", needed: "A readable JAR or directory of Java class files"
        });
        if (signal.aborted) break;
      }
    }
    return new SourceClasspath(entries, diagnostics);
  }

  find(className: string, consumeProbe: () => boolean, signal: AbortSignal, requiredOwner?: string): {
    candidates: SourceCandidate[]; diagnostics: SourceDiagnostic[]; limited: boolean;
  } {
    const candidates: SourceCandidate[] = [];
    const paths = binaryClassPaths(className, requiredOwner);
    if (signal.aborted) return { candidates, limited: true, diagnostics: [{
      code: "SOURCE_LIMIT", message: "Classpath lookup timed out or was canceled"
    }] };
    for (const { rootId, content } of this.entries) {
      if (!consumeProbe()) {
        return { candidates, limited: true, diagnostics: [{
          code: "SOURCE_LIMIT", rootId, path: paths[0],
          message: signal.aborted ? "Classpath lookup timed out or was canceled" : "Classpath probe limit reached"
        }] };
      }
      if (!content) continue;
      const relative = paths.find((entry) => content.kind === "archive" ? content.classes.has(entry) : content.files.has(entry));
      if (relative) candidates.push({ className, rootId, path: content.kind === "archive" ? `${content.name}!/${relative}` : relative });
    }
    return { candidates, diagnostics: [], limited: false };
  }

  async materialize(directory: string, signal?: AbortSignal): Promise<string[]> {
    const entries: string[] = [];
    await fs.mkdir(directory, { recursive: true });
    for (const { rootId, content } of this.entries) {
      signal?.throwIfAborted();
      if (!content) continue;
      try {
        if (content.kind === "archive") {
          const destination = path.join(directory, `${rootId}.jar`);
          await copyChecked(content.file, destination, signal);
          entries.push(destination);
        } else {
          const destination = path.join(directory, rootId);
          await fs.mkdir(destination, { recursive: true });
          for (const [relative, hash] of content.files) {
            signal?.throwIfAborted();
            const original = await fs.realpath(path.join(content.directory, relative));
            if (!pathInside(content.directory, original)) {
              throw new SourceClasspathError("SOURCE_CHANGED", `Classpath input for ${rootId} now resolves outside its directory`);
            }
            const target = path.join(destination, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await copyChecked({ path: original, hash }, target, signal);
          }
          entries.push(destination);
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof SourceClasspathError) throw error;
        throw new SourceClasspathError("SOURCE_CHANGED", `Could not reproduce the original binary inputs for ${rootId}`);
      }
    }
    return entries;
  }
}

async function captureClasses(directory: string, signal: AbortSignal): Promise<{
  files: ReadonlyMap<string, string>; skippedLinks: boolean;
}> {
  const files = new Map<string, string>();
  const pending = [directory];
  let skippedLinks = false;
  while (pending.length) {
    signal.throwIfAborted();
    const current = await fs.realpath(pending.pop()!);
    if (!pathInside(directory, current)) throw new Error("Classpath directory escaped its configured boundary");
    for await (const item of await fs.opendir(current)) {
      signal.throwIfAborted();
      const absolute = path.join(current, item.name);
      if (item.isSymbolicLink()) skippedLinks = true;
      if (item.isDirectory()) pending.push(absolute);
      if (item.isFile() && item.name.endsWith(".class")) {
        const relative = path.relative(directory, absolute).split(path.sep).join("/");
        const real = await fs.realpath(absolute);
        if (!pathInside(directory, real)) throw new Error("Classpath file escaped its configured boundary");
        files.set(relative, await hashFile(real, signal));
      }
    }
  }
  return { files, skippedLinks };
}

function binaryClassPaths(className: string, requiredOwner?: string): string[] {
  const segments = className.split(".");
  const boundaries = requiredOwner ? segments.slice(0, requiredOwner.split(".").length) : segments;
  return boundaries.map((_, index) => {
    const type = segments.slice(index).join("$");
    return `${[...segments.slice(0, index), type].join("/")}.class`;
  }).reverse();
}

async function copyChecked(file: FileVersion, destination: string, signal?: AbortSignal): Promise<void> {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(file.path),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(destination, { flags: "wx" }),
    { signal }
  );
  if (hash.digest("hex") !== file.hash) {
    throw new SourceClasspathError("SOURCE_CHANGED", "A classpath input changed after the snapshot was created");
  }
}

async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathInside(root: string, candidate: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || candidate.startsWith(prefix);
}
