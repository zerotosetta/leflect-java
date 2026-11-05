import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Independent source inventory; uses the JDK compiler API, not the worker parser.
// node scripts/audit2/run-execution-oracle.mjs --source PROJECT --out RUN
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.source || !args.out) throw new Error("Expected --source PROJECT --out RUN");
const sourceRoot = path.resolve(args.source), outRoot = path.resolve(args.out);
const folder = path.join(outRoot, "verification/java-execution"), classes = path.join(folder, "classes");
const helper = fileURLToPath(new URL("ExecutionAuditExtract.java", import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(outRoot, "config.json"), "utf8"));
const classpath = config.java.classpath.map(file => path.resolve(file));
for (const file of classpath) if (!fs.existsSync(file)) throw new Error(`Missing classpath entry: ${file}`);
fs.mkdirSync(classes, { recursive: true });
fs.copyFileSync(helper, path.join(folder, "ExecutionAuditExtract.java"));
const compileArgs = ["-encoding", "UTF-8", "-d", classes, helper];
const compile = spawnSync("javac", compileArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
fs.writeFileSync(path.join(folder, "compile.log"), `${compile.stdout ?? ""}${compile.stderr ?? ""}`);
if (compile.status !== 0) throw new Error(`Independent inventory compilation failed: ${compile.error?.message ?? compile.stderr}`);
const runArgs = ["-classpath", classes, "ExecutionAuditExtract", sourceRoot, classpath.join(path.delimiter), path.join(folder, "source.tsv")];
const execution = spawnSync("java", runArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const log = `${execution.stdout ?? ""}${execution.stderr ?? ""}`;
fs.writeFileSync(path.join(folder, "run.log"), log);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const passed = execution.status === 0 && /Source files=42, compiler errors=0/.test(log);
const evidence = { generatedAt: new Date().toISOString(), sourceRoot, outRoot,
  methodology: "Independent JDK compiler Tree API parse and --release 8 attribution; source operation kind, inclusive range, declaration, call order and enclosing short-circuit operands are inventoried without importing analyzer implementation.",
  compile: { command: ["javac", ...compileArgs], exitCode: compile.status }, run: { command: ["java", ...runArgs], exitCode: execution.status },
  helper: { path: helper, sha256: hash(helper) }, inventory: { path: path.join(folder, "source.tsv"), sha256: hash(path.join(folder, "source.tsv")) },
  classpath: classpath.map(file => ({ path: file, ...(fs.statSync(file).isFile() ? { sha256: hash(file) } : { kind: "compiled-project-classes" }) })), passed };
fs.writeFileSync(path.join(folder, "oracle.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ passed, inventory: evidence.inventory.path, evidence: path.join(folder, "oracle.json") }, null, 2));
if (!passed) process.exitCode = 1;
