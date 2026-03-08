import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { LeflectConfig } from "@lefectjava/schema";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

const OUTPUT_CLASS_DIRECTORIES = [
  path.join("target", "classes"),
  path.join("src", "main", "webapp", "WEB-INF", "classes")
];

export async function resolveJspClasspathEntries(config: LeflectConfig): Promise<string[]> {
  const entries = new Set<string>();
  const configuredEntries = config.jsp?.classpath ?? [];

  for (const entry of configuredEntries) {
    entries.add(entry);
  }

  try {
    for (const entry of await collectMavenClasspathEntries(config.root, config.jsp?.mavenCommand)) {
      entries.add(entry);
    }
  } catch (error) {
    if (configuredEntries.length === 0) {
      throw error;
    }
  }

  for (const relativeDir of OUTPUT_CLASS_DIRECTORIES) {
    const candidate = path.join(config.root, relativeDir);
    if (await pathExists(candidate)) {
      entries.add(candidate);
    }
  }

  return [...entries];
}

export async function createJspDependencyCacheInput(
  config: LeflectConfig
): Promise<Record<string, unknown>> {
  return {
    mavenCommand: config.jsp?.mavenCommand ?? null,
    classpath: config.jsp?.classpath ?? [],
    pomSha1: await sha1IfExists(path.join(config.root, "pom.xml"))
  };
}

export async function collectMavenClasspathEntries(
  root: string,
  explicitCommand?: string
): Promise<string[]> {
  const pomPath = path.join(root, "pom.xml");
  if (!(await pathExists(pomPath))) {
    return [];
  }

  const command = await resolveMavenCommand(root, explicitCommand);
  if (!command) {
    return [];
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-jsp-cp-"));
  const outputFile = path.join(tempDir, "classpath.txt");

  try {
    const result = await runCommand(command, [
      "-q",
      "dependency:build-classpath",
      "-Dmdep.includeScope=runtime",
      `-Dmdep.outputFile=${outputFile}`
    ], root);

    if (result.error || result.code !== 0) {
      if (explicitCommand) {
        const detail = result.stderr || result.stdout || result.error?.message || "unknown error";
        throw new Error(`Failed to resolve Maven JSP classpath: ${detail}`);
      }
      return [];
    }

    const raw = await fs.readFile(outputFile, "utf8").catch(() => "");
    return splitClasspath(raw).filter((entry) => entry.length > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function resolveMavenCommand(
  root: string,
  explicitCommand?: string
): Promise<string | undefined> {
  if (explicitCommand) {
    return explicitCommand;
  }

  const wrapperCandidates = ["mvnw", "mvnw.cmd", "mvnw.bat"].map((file) => path.join(root, file));
  for (const candidate of wrapperCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return "mvn";
}

export function splitClasspath(value: string): string[] {
  return value
    .trim()
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha1IfExists(target: string): Promise<string | null> {
  if (!(await pathExists(target))) {
    return null;
  }

  const raw = await fs.readFile(target);
  return createHash("sha1").update(raw).digest("hex");
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let processError: Error | undefined;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code,
        stdout,
        stderr,
        error: processError
      });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      processError = error;
      finish(null);
    });

    child.on("close", (code) => {
      finish(code);
    });
  });
}
