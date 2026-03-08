import fs from "fs/promises";
import os from "os";
import path from "path";

const JAVA_WORKER_JAR_PATTERN = /^leflectjava-java-worker-.*\.jar$/;

export async function resolveJavaWorkerJar(configuredPath?: string): Promise<string | undefined> {
  if (configuredPath) {
    return resolveUsableWorkerJar(configuredPath);
  }

  const envPath = process.env.LEFLECT_JAVA_WORKER_JAR;
  if (envPath) {
    const resolvedEnvPath = await resolveUsableWorkerJar(envPath);
    if (resolvedEnvPath) {
      return resolvedEnvPath;
    }
  }

  const manifestCandidate = await resolveWorkerJarFromManifest();
  if (manifestCandidate) {
    return manifestCandidate;
  }

  for (const directory of candidateWorkerJarDirectories()) {
    const candidate = await findWorkerJar(directory);
    if (!candidate) {
      continue;
    }

    const resolvedCandidate = await resolveUsableWorkerJar(candidate);
    if (resolvedCandidate) {
      return resolvedCandidate;
    }
  }

  return undefined;
}

function candidateWorkerJarDirectories(): string[] {
  return [
    path.resolve(__dirname, "java"),
    path.resolve(__dirname, "..", "java"),
    path.resolve(__dirname, "..", "..", "..", "java-worker", "target"),
    path.resolve(process.cwd(), "java-worker", "target")
  ];
}

function candidateWorkerJarManifestPaths(): string[] {
  return [
    path.resolve(__dirname, "java", "worker-jar.json"),
    path.resolve(__dirname, "..", "java", "worker-jar.json")
  ];
}

async function findWorkerJar(directory: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const jars = entries
      .filter((entry) => entry.isFile() && JAVA_WORKER_JAR_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const candidate = jars[0];
    return candidate ? path.join(directory, candidate) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveWorkerJarFromManifest(): Promise<string | undefined> {
  for (const manifestPath of candidateWorkerJarManifestPaths()) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { fileName?: string };
      if (!manifest.fileName) {
        continue;
      }

      const candidate = path.join(path.dirname(manifestPath), manifest.fileName);
      const resolvedCandidate = await resolveUsableWorkerJar(candidate);
      if (resolvedCandidate) {
        return resolvedCandidate;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function resolveUsableWorkerJar(targetPath: string): Promise<string | undefined> {
  const resolvedPath = path.resolve(targetPath);
  if (isPackagedSnapshotPath(resolvedPath)) {
    try {
      return await extractBundledWorkerJar(resolvedPath);
    } catch {
      return undefined;
    }
  }

  if (!(await fileExists(resolvedPath))) {
    return undefined;
  }

  return resolvedPath;
}

function isPackagedSnapshotPath(targetPath: string): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg) && /(^|[\\/])snapshot([\\/]|$)/i.test(targetPath);
}

async function extractBundledWorkerJar(snapshotPath: string): Promise<string> {
  const targetDirectory = path.join(os.tmpdir(), "leflect-java", "java");
  const extractedPath = path.join(targetDirectory, path.basename(snapshotPath));
  await fs.mkdir(targetDirectory, { recursive: true });

  const snapshotBytes = await fs.readFile(snapshotPath);
  let shouldWrite = true;

  try {
    const existingBytes = await fs.readFile(extractedPath);
    shouldWrite = !existingBytes.equals(snapshotBytes);
  } catch {
    shouldWrite = true;
  }

  if (shouldWrite) {
    await fs.writeFile(extractedPath, snapshotBytes);
    await fs.chmod(extractedPath, 0o644);
  }

  return extractedPath;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
