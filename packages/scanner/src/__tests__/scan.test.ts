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
  });
});
