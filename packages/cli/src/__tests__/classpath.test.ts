import { EventEmitter } from "events";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectMavenClasspathEntries, resolveDependencyClasspathEntries } from "../classpath";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

describe("Maven analysis dependency scopes", () => {
  let root: string;
  afterEach(async () => { vi.resetAllMocks(); if (root) await fs.rm(root, { recursive: true, force: true }); });

  it("unions compile/provided/system and runtime without injecting test dependencies", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-maven-scopes-"));
    await fs.writeFile(path.join(root, "pom.xml"), "<project/>");
    const provided = path.join(root, "servlet-provided.jar");
    const compile = path.join(root, "shared-compile.jar");
    const runtime = path.join(root, "runtime.jar");
    vi.mocked(spawn).mockImplementation(((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      const scope = args.find(arg => arg.startsWith("-Dmdep.includeScope="))?.split("=")[1];
      const output = args.find(arg => arg.startsWith("-Dmdep.outputFile="))!.slice("-Dmdep.outputFile=".length);
      queueMicrotask(() => {
        void fs.writeFile(output, (scope === "compile" ? [provided, compile] : [compile, runtime]).join(path.delimiter))
          .then(() => child.emit("close", 0));
      });
      return child;
    }) as typeof spawn);
    expect(await collectMavenClasspathEntries(root, "fixture-maven")).toEqual([provided, compile, runtime]);
    expect(vi.mocked(spawn).mock.calls.map(call => (call[1] as string[]).find(arg => arg.startsWith("-Dmdep.includeScope="))))
      .toEqual(["-Dmdep.includeScope=compile", "-Dmdep.includeScope=runtime"]);
  });

  it("can disable Maven resolution for a reproducible offline fallback environment", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-maven-off-"));
    await fs.writeFile(path.join(root, "pom.xml"), "<project/>");
    expect(await resolveDependencyClasspathEntries({ root, configuredEntries: ["project.jar"], mavenEnabled: false }))
      .toEqual(["project.jar"]);
    expect(spawn).not.toHaveBeenCalled();
  });
});
