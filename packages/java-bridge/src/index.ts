import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

import { JavaInputManifest, JspInputManifest } from "@leflect-java/schema";

export type JavaWorkerCommand = {
  javaPath?: string;
  jreHome?: string;
  javaHome?: string;
  jarPath: string;
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
};

export type JavaWorkerResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function buildJavaCommand(command: JavaWorkerCommand): {
  command: string;
  args: string[];
} {
  const javaPath = resolveJavaPath(command.javaPath, command.jreHome, command.javaHome);
  const args = ["-jar", command.jarPath, ...command.args];

  return { command: javaPath, args };
}

export async function runJavaWorker(command: JavaWorkerCommand): Promise<JavaWorkerResult> {
  command.signal?.throwIfAborted();
  const { command: exec, args } = buildJavaCommand(command);

  return new Promise((resolve, reject) => {
    const child = spawn(exec, args, {
      cwd: command.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let spawnError: Error | undefined;
    const cancel = () => child.kill();
    command.signal?.addEventListener("abort", cancel, { once: true });
    if (command.signal?.aborted) cancel();
    child.on("error", (error) => { spawnError = error; });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      command.signal?.removeEventListener("abort", cancel);
      if (command.signal?.aborted) reject(command.signal.reason);
      else if (spawnError) reject(spawnError);
      else resolve({ code, stdout, stderr });
    });
  });
}

export async function writeJavaManifest(
  manifestPath: string,
  manifest: JavaInputManifest
): Promise<void> {
  await writeManifest(manifestPath, manifest);
}

export async function writeJspManifest(
  manifestPath: string,
  manifest: JspInputManifest
): Promise<void> {
  await writeManifest(manifestPath, manifest);
}

async function writeManifest(
  manifestPath: string,
  manifest: JavaInputManifest | JspInputManifest
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function resolveJavaPath(javaPath?: string, jreHome?: string, javaHome?: string): string {
  if (javaPath) {
    return javaPath;
  }
  if (jreHome) {
    return path.join(jreHome, "bin", "java");
  }
  if (javaHome) {
    return path.join(javaHome, "bin", "java");
  }
  return "java";
}
