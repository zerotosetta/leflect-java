import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { artifactsRoot } from "./release-common.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith("--")) {
    continue;
  }
  const key = token.slice(2);
  const nextToken = process.argv[index + 1];
  if (!nextToken || nextToken.startsWith("--")) {
    args.set(key, true);
    continue;
  }
  args.set(key, nextToken);
  index += 1;
}

const defaultBinary = path.join(artifactsRoot, "binary", "dist", process.platform === "win32" ? "leflect.exe" : "leflect");
const binaryPath = path.resolve(String(args.get("binary") || defaultBinary));
await fs.access(binaryPath).catch(() => {
  throw new Error(`Binary not found at ${binaryPath}. Run 'pnpm binary:build' first.`);
});

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-binary-test-"));
try {
  await fs.mkdir(path.join(workspaceRoot, "src", "main", "java", "demo"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src", "main", "webapp"), { recursive: true });

  await fs.writeFile(
    path.join(workspaceRoot, "src", "main", "java", "demo", "Service.java"),
    [
      "package demo;",
      "",
      "public class Service {",
      "  public String greet(String name) {",
      "    return \"Hello, \" + name;",
      "  }",
      "}"
    ].join("\n") + "\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(workspaceRoot, "src", "main", "webapp", "index.jsp"),
    [
      "<%@ page contentType=\"text/html; charset=UTF-8\" %>",
      "<html><body>Hello Leflect</body></html>"
    ].join("\n") + "\n",
    "utf8"
  );

  runBinary(["--help"]);
  runBinary(["init", "--root", workspaceRoot, "--yes", "--force"]);
  runBinary(["analyze", "--root", workspaceRoot, "--config", path.join(workspaceRoot, "leflect.config.json")]);

  await fs.access(path.join(workspaceRoot, "analysis", "java-ast", "src", "main", "java", "demo", "Service.java.json"));
  await fs.access(path.join(workspaceRoot, "analysis", "jsp-ast", "src", "main", "webapp", "index.jsp.json"));

  console.log(`Binary validation passed: ${binaryPath}`);
} finally {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

function runBinary(commandArgs) {
  const result = spawnSync(binaryPath, commandArgs, {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }
}
