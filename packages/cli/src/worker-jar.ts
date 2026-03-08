import fs from "fs/promises";
import path from "path";

export const JAVA_WORKER_JAR_NAME = "leflectjava-java-worker-0.1.0.jar";

export async function resolveJavaWorkerJar(configuredPath?: string): Promise<string | undefined> {
  if (configuredPath) {
    return configuredPath;
  }

  const envPath = process.env.LEFLECT_JAVA_WORKER_JAR;
  if (envPath) {
    const resolvedEnvPath = path.resolve(envPath);
    if (await fileExists(resolvedEnvPath)) {
      return resolvedEnvPath;
    }
  }

  for (const candidate of candidateWorkerJarPaths()) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function candidateWorkerJarPaths(): string[] {
  return [
    path.resolve(__dirname, "java", JAVA_WORKER_JAR_NAME),
    path.resolve(__dirname, "..", "java", JAVA_WORKER_JAR_NAME),
    path.resolve(__dirname, "..", "..", "..", "java-worker", "target", JAVA_WORKER_JAR_NAME),
    path.resolve(process.cwd(), "java-worker", "target", JAVA_WORKER_JAR_NAME)
  ];
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
