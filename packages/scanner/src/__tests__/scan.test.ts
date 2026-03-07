import os from "os";
import path from "path";
import { mkdir, mkdtemp, writeFile, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { scanWorkspace } from "../scan";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("scanWorkspace", () => {
  it("builds manifests and respects ignore rules", async () => {
    const root = await tempDir("leflect-scan-");

    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "view"), { recursive: true });
    await mkdir(path.join(root, "ignore"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });

    await writeFile(path.join(root, "src", "A.java"), "class A {}");
    await writeFile(path.join(root, "view", "B.jsp"), "<%=" + "1" + "%>");
    await writeFile(path.join(root, "ignore", "Skip.java"), "class Skip {}");
    await writeFile(path.join(root, "node_modules", "X.js"), "console.log('x')");
    await writeFile(path.join(root, "tmp.tmp"), "tmp");

    const ignoreFile = path.join(root, ".leflectignore");
    await writeFile(ignoreFile, "ignore/\n*.tmp\n");

    const analysisOut = path.join(root, "analysis");

    const result = await scanWorkspace({
      root,
      analysisOut,
      ignoreFile
    });

    expect(result.totalFiles).toBe(2);
    expect(result.javaFiles).toEqual(["src/A.java"]);
    expect(result.jspFiles).toEqual(["view/B.jsp"]);

    const manifestPath = path.join(analysisOut, "manifests", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      totalFiles: number;
    };

    expect(manifest.totalFiles).toBe(2);

    const filesPath = path.join(analysisOut, "files", "files.jsonl");
    const lines = (await readFile(filesPath, "utf8")).trim().split("\n");
    const records = lines.map((line) => JSON.parse(line) as { path: string; domain?: string; hash: string; type: string });

    const javaRecord = records.find((record) => record.path === "src/A.java");
    const jspRecord = records.find((record) => record.path === "view/B.jsp");

    expect(javaRecord?.domain).toBe("src");
    expect(jspRecord?.domain).toBe("view");
    expect(javaRecord?.type).toBe("java");
    expect(jspRecord?.type).toBe("jsp");
    expect(javaRecord?.hash.startsWith("sha1:")).toBe(true);

    const cachePath = path.join(analysisOut, "cache", "file-hashes.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as {
      changed: string[];
      removed: string[];
    };

    expect(cache.changed).toEqual(["src/A.java", "view/B.jsp"]);
    expect(cache.removed).toEqual([]);

    await writeFile(path.join(root, "src", "A.java"), "class A { int value; }");

    const secondRun = await scanWorkspace({
      root,
      analysisOut,
      ignoreFile
    });

    expect(secondRun.changedFiles).toEqual(["src/A.java"]);
    expect(secondRun.removedFiles).toEqual([]);
  });
});
