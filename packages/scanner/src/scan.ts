import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import ignore from "ignore";

export type FileRecord = {
  path: string;
  type: "java" | "jsp" | "tld" | "other";
  ext: string;
  size: number;
  mtimeMs: number;
  domain?: string;
  hash: string;
};

export type ScanOptions = {
  root: string;
  analysisOut: string;
  ignoreFile?: string;
};

export type ScanResult = {
  root: string;
  analysisOut: string;
  totalFiles: number;
  totalBytes: number;
  byExtension: Record<string, number>;
  javaFiles: string[];
  jspFiles: string[];
  tldFiles: string[];
};

const DEFAULT_IGNORE = [".git/", "node_modules/"];

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const root = path.resolve(options.root);
  const analysisOut = path.resolve(options.analysisOut);

  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  const relativeAnalysis = path.relative(root, analysisOut);
  if (relativeAnalysis && !relativeAnalysis.startsWith("..")) {
    ig.add(normalizePath(relativeAnalysis) + "/");
  }

  const ignoreFile = options.ignoreFile ?? (await resolveDefaultIgnoreFile(root));
  if (ignoreFile) {
    const content = await fsp.readFile(ignoreFile, "utf8");
    ig.add(content);

    const relativeIgnore = path.relative(root, ignoreFile);
    if (relativeIgnore && !relativeIgnore.startsWith("..")) {
      ig.add(normalizePath(relativeIgnore));
    }
  }

  await ensureDir(path.join(analysisOut, "files"));
  await ensureDir(path.join(analysisOut, "manifests"));

  const filesStream = fs.createWriteStream(
    path.join(analysisOut, "files", "files.jsonl"),
    "utf8"
  );

  const byExtension: Record<string, number> = {};
  const javaFiles: string[] = [];
  const jspFiles: string[] = [];
  const tldFiles: string[] = [];

  let totalFiles = 0;
  let totalBytes = 0;

  await walk(root, async (filePath) => {
    const relativePath = normalizePath(path.relative(root, filePath));
    if (!relativePath || isIgnored(relativePath, ig)) {
      return;
    }

    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = classifyType(ext);
    totalFiles += 1;
    totalBytes += stat.size;
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;

    if (type === "java") {
      javaFiles.push(relativePath);
    } else if (type === "jsp") {
      jspFiles.push(relativePath);
    } else if (type === "tld") {
      tldFiles.push(relativePath);
    }

    const record: FileRecord = {
      path: relativePath,
      type,
      ext,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      domain: resolveDomain(relativePath),
      hash: await hashFile(filePath)
    };

    filesStream.write(`${JSON.stringify(record)}\n`);
  });

  await new Promise<void>((resolve, reject) => {
    filesStream.end((err?: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  const manifest = {
    root,
    generatedAt: new Date().toISOString(),
    totalFiles,
    totalBytes,
    byExtension,
    byType: {
      java: javaFiles.length,
      jsp: jspFiles.length,
      tld: tldFiles.length
    },
    outputs: {
      files: "files/files.jsonl",
      manifest: "manifests/manifest.json",
      javaFiles: "manifests/java-files.json",
      jspFiles: "manifests/jsp-files.json",
      tldFiles: "manifests/tld-files.json"
    }
  };

  await fsp.writeFile(
    path.join(analysisOut, "manifests", "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  await writeListManifest(root, analysisOut, "java-files.json", javaFiles);
  await writeListManifest(root, analysisOut, "jsp-files.json", jspFiles);
  await writeListManifest(root, analysisOut, "tld-files.json", tldFiles);

  return {
    root,
    analysisOut,
    totalFiles,
    totalBytes,
    byExtension,
    javaFiles,
    jspFiles,
    tldFiles
  };
}

async function resolveDefaultIgnoreFile(root: string): Promise<string | undefined> {
  const candidate = path.join(root, ".leflectignore");
  try {
    await fsp.access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function isIgnored(relativePath: string, ig: ReturnType<typeof ignore>): boolean {
  if (ig.ignores(relativePath)) {
    return true;
  }
  if (relativePath.endsWith("/")) {
    return ig.ignores(relativePath);
  }
  return ig.ignores(`${relativePath}/`);
}

async function walk(dir: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      await onFile(fullPath);
    }
  }
}

async function ensureDir(target: string): Promise<void> {
  await fsp.mkdir(target, { recursive: true });
}

function normalizePath(target: string): string {
  return target.split(path.sep).join("/");
}

function resolveDomain(relativePath: string): string | undefined {
  const segments = relativePath.split("/");
  if (segments.length <= 1) {
    return undefined;
  }
  return segments[0] || undefined;
}

function classifyType(ext: string): FileRecord["type"] {
  if (ext === ".java") {
    return "java";
  }
  if (ext === ".jsp" || ext === ".jspx") {
    return "jsp";
  }
  if (ext === ".tld") {
    return "tld";
  }
  return "other";
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha1");

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
  });

  return `sha1:${hash.digest("hex")}`;
}

async function writeListManifest(
  root: string,
  analysisOut: string,
  filename: string,
  files: string[]
): Promise<void> {
  const payload = {
    root,
    generatedAt: new Date().toISOString(),
    files
  };

  await fsp.writeFile(
    path.join(analysisOut, "manifests", filename),
    JSON.stringify(payload, null, 2)
  );
}
