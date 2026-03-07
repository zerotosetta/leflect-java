import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export type JavaWorkerCommand = {
  javaPath?: string;
  javaHome?: string;
  jarPath: string;
  args: string[];
  cwd?: string;
};

export type JavaWorkerResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type JavaInputManifest = {
  root: string;
  files: string[];
  outputDir: string;
  errorLog: string;
};

export function buildJavaCommand(command: JavaWorkerCommand): {
  command: string;
  args: string[];
} {
  const javaPath = resolveJavaPath(command.javaPath, command.javaHome);
  const args = ["-jar", command.jarPath, ...command.args];

  return { command: javaPath, args };
}

export function runJavaWorker(command: JavaWorkerCommand): Promise<JavaWorkerResult> {
  const { command: exec, args } = buildJavaCommand(command);

  return new Promise((resolve) => {
    const child = spawn(exec, args, {
      cwd: command.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function writeJavaManifest(
  manifestPath: string,
  manifest: JavaInputManifest
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function resolveJavaPath(javaPath?: string, javaHome?: string): string {
  if (javaPath) {
    return javaPath;
  }
  if (javaHome) {
    return path.join(javaHome, "bin", "java");
  }
  return "java";
}
