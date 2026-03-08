import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type ClasspathResolutionOptions = {
  root: string;
  configuredEntries?: string[];
  mavenCommand?: string;
  outputDirectories?: string[];
  markerFiles?: string[];
  strictMaven?: boolean;
  autoDiscovery?: {
    enabled?: boolean;
    maxRetries?: number;
    searchRoots?: string[];
  };
};

export async function resolveDependencyClasspathEntries(
  options: ClasspathResolutionOptions
): Promise<string[]> {
  const entries = new Set<string>();
  const configuredEntries = options.configuredEntries ?? [];

  for (const entry of configuredEntries) {
    entries.add(entry);
  }

  try {
    for (const entry of await collectMavenClasspathEntries(options.root, options.mavenCommand)) {
      entries.add(entry);
    }
  } catch (error) {
    if (options.strictMaven) {
      throw error;
    }
  }

  for (const relativeDir of options.outputDirectories ?? []) {
    const candidate = path.join(options.root, relativeDir);
    if (await pathExists(candidate)) {
      entries.add(candidate);
    }
  }

  return [...entries];
}

export async function createDependencyCacheInput(
  options: ClasspathResolutionOptions
): Promise<Record<string, unknown>> {
  const markerFiles = options.markerFiles ?? [];
  const markerHashes = await Promise.all(
    markerFiles.map(async (file) => [file, await sha1IfExists(path.join(options.root, file))] as const)
  );

  return {
    mavenCommand: options.mavenCommand ?? null,
    classpath: options.configuredEntries ?? [],
    autoDiscovery: options.autoDiscovery ?? null,
    markerFiles: Object.fromEntries(markerHashes)
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

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-cp-"));
  const outputFile = path.join(tempDir, "classpath.txt");

  try {
    const result = await runCommand(
      command,
      [
        "-q",
        "dependency:build-classpath",
        "-Dmdep.includeScope=runtime",
        `-Dmdep.outputFile=${outputFile}`
      ],
      root
    );

    if (result.error || result.code !== 0) {
      if (explicitCommand) {
        const detail = result.stderr || result.stdout || result.error?.message || "unknown error";
        throw new Error(`Failed to resolve Maven classpath: ${detail}`);
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
