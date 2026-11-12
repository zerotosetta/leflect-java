import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import type { LeflectConfig } from "@leflect-java/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SourceClasspath } from "../source-classpath";
import type { McpSystemLogger } from "../source-mcp-log";

describe("binary classpath candidate trace", () => {
  const className = "app.Outer.Inner";
  let root: string;
  let config: LeflectConfig;
  let events: Record<string, unknown>[];

  const trace: McpSystemLogger = (event, fields) => { events.push({ event, ...fields }); };

  function candidate(rootId: string, path: string, outcome: string, reason: string) {
    return { event: "lookup.candidate", kind: "binary", className, rootId, path, outcome, reason };
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect binary trace "));
    events = [];
    const archive = path.join(root, "library.jar");
    const directory = path.join(root, "directory");
    const zip = new AdmZip();
    zip.addFile("app/Outer$Inner.class", Buffer.from("archive entry"));
    await fs.writeFile(archive, zip.toBuffer());
    await fs.mkdir(path.join(directory, "app", "Outer"), { recursive: true });
    await fs.writeFile(path.join(directory, "app", "Outer", "Inner.class"), "directory entry");
    config = {
      root, analysisOut: path.join(root, "analysis"),
      java: { classpath: [archive, directory, "./library.jar", path.join(root, "missing.jar")] }
    };
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it("records actual archive and directory member checks in lookup order", async () => {
    const signal = new AbortController().signal;
    const classpath = await SourceClasspath.capture(config, signal);
    const result = classpath.find(className, () => true, signal, undefined, trace);
    expect(result.candidates).toEqual([
      { className, rootId: "classpath-1", path: "library.jar!/app/Outer$Inner.class" },
      { className, rootId: "classpath-2", path: "app/Outer/Inner.class" }
    ]);
    expect(events).toEqual([
      candidate("classpath-1", "library.jar!/app/Outer/Inner.class", "rejected", "not_in_catalog"),
      candidate("classpath-1", "library.jar!/app/Outer$Inner.class", "matched", "class_found"),
      candidate("classpath-2", "app/Outer/Inner.class", "matched", "class_found"),
      { ...candidate("classpath-3", "library.jar!/app/Outer/Inner.class", "skipped", "classpath_alias"), aliasOf: "classpath-1" },
      candidate("classpath-4", "missing.jar!/app/Outer/Inner.class", "skipped", "classpath_unavailable")
    ]);
  });

  it("reports a limit at the next candidate without recording probes that never ran", async () => {
    const signal = new AbortController().signal;
    const classpath = await SourceClasspath.capture(config, signal);
    let budget = 1;
    const result = classpath.find(className, () => budget-- > 0, signal, "app.Outer", trace);
    expect(result).toMatchObject({ limited: true, candidates: [{ rootId: "classpath-1" }] });
    expect(events).toEqual([
      candidate("classpath-1", "library.jar!/app/Outer$Inner.class", "matched", "class_found"),
      candidate("classpath-2", "app/Outer$Inner.class", "skipped", "probe_limit")
    ]);
  });

  it("distinguishes cancellation during capture from cancellation before lookup", async () => {
    const signal = new AbortController().signal;
    const classpath = await SourceClasspath.capture(config, AbortSignal.abort());
    classpath.find(className, () => true, signal, undefined, trace);
    classpath.find(className, () => true, AbortSignal.abort(), undefined, trace);
    expect(events).toEqual([
      candidate("classpath-1", "library.jar!/app/Outer/Inner.class", "skipped", "classpath_capture_cancelled"),
      candidate("classpath-1", "library.jar!/app/Outer/Inner.class", "skipped", "cancelled")
    ]);
  });
});
