import { spawn } from "child_process";

export type JavaWorkerCommand = {
  javaPath?: string;
  jarPath: string;
  args: string[];
  cwd?: string;
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
  const javaPath = command.javaPath ?? "java";
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
