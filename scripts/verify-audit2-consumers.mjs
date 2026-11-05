import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Verify the actual HTTP detail endpoint and persisted report against every Java shard.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "analysis/legacy-bank-java8/audit2-20261105-1853");
const config = JSON.parse(fs.readFileSync(path.join(out, "config.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(out, "index/java-files.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(out, "report/summary.json"), "utf8"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const options = { appDir: path.join(workspace, "apps/leflect-java-projection"), config: { ...config, analysisOut: out },
  configPath: path.join(out, "config.json"), host: "127.0.0.1", port, mode: "production", serveUi: false };
const child = spawn(process.execPath, ["-e", "require(process.argv[1]).runProjectionServer(JSON.parse(process.argv[2])).catch(e=>{console.error(e);process.exit(1)})",
  path.join(workspace, "packages/cli/dist/projection-server.js"), JSON.stringify(options)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", data => { logs += data; });
child.stderr.on("data", data => { logs += data; });
const checks = [];
const add = (name, passed, evidence = {}) => checks.push({ name, passed, ...evidence });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (logs.includes("API endpoint")) { ready = true; break; }
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`API did not become ready: ${logs}`);
  for (const file of manifest) {
    const expected = JSON.parse(fs.readFileSync(path.join(out, "index", file.metadataPath), "utf8"));
    const response = await fetch(`http://127.0.0.1:${port}/api/file-detail?path=${encodeURIComponent(file.path)}`);
    const actual = await response.json();
    add("HTTP file detail preserves full indexed metadata", response.ok && same(expected, actual.metadata), { file: file.path });
    add("HTTP detail exposes original source", actual.source?.content === fs.readFileSync(path.join(config.root, file.path), "utf8"), { file: file.path });
    for (const method of expected.methods) {
      const model = method.executionModel, summary = report.javaExecution?.find(row => row.methodId === method.id);
      add("report prefers the same v2 model and coverage", model?.version === 2 && summary?.modelVersion === 2 &&
        summary.steps === model.orderedSteps.length && summary.flowNodes === model.flowGraph.nodes.length &&
        summary.flowEdges === model.flowGraph.edges.length && same(summary.coverage, model.coverage), { file: file.path, methodId: method.id });
    }
  }
  const record = { generatedAt: new Date().toISOString(), passed: checks.every(row => row.passed),
    files: manifest.length, methods: report.javaExecution?.length, checks };
  fs.writeFileSync(path.join(out, "verification/audit2-consumers.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ passed: record.passed, files: record.files, methods: record.methods, checks: checks.length }));
  if (!record.passed) process.exitCode = 1;
} finally {
  if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
}
