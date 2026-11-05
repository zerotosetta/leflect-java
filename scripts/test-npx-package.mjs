import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Test the actual tarball outside the repository, with no workspace packages.
// node scripts/test-npx-package.mjs [--tarball FILE] [--report FILE] [--keep-temp]
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index].replace(/^--/, "");
  args.set(key, key === "keep-temp" ? true : process.argv[++index]);
}
const manifest = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"));
const tarball = path.resolve(String(args.get("tarball") ?? path.join(workspace, ".artifacts/packages", `leflect-java-${manifest.version}.tgz`)));
const reportPath = path.resolve(String(args.get("report") ?? path.join(workspace, ".artifacts/npx-package-validation.json")));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "leflect-npx-package-"));
const consumer = path.join(temporaryRoot, "consumer"), tool = path.join(temporaryRoot, "devtools/typescript");
const record = { generatedAt: new Date().toISOString(), tarball, temporaryRoot, consumer,
  methodology: "Offline installation of one standalone tarball outside the repository. Only a copied TypeScript compiler is supplied as a development tool; runtime workspace imports are forbidden and every compiler program file must remain under the isolated temporary root.",
  checks: [], runtime: [], compilers: [], passed: false };
const check = (name, passed, evidence = {}) => {
  record.checks.push({ name, passed: Boolean(passed), ...evidence });
  if (!passed) throw new Error(name);
};
function execute(command, commandArgs, cwd = consumer) {
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const result = spawnSync(command, commandArgs, { cwd, env, windowsHide: true, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${commandArgs.join(" ")} failed (${result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`);
  return result;
}
const canonical = value => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
function within(value, root) { const a = canonical(value), b = canonical(root); return a === b || a.startsWith(b + path.sep); }
async function npmCli() {
  const candidates = [args.get("npm-cli"), process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(process.env.PATH ?? "").split(path.delimiter).map(folder => path.join(folder, "node_modules/npm/bin/npm-cli.js"))];
  for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
    const resolved = await fs.realpath(path.join(folder, process.platform === "win32" ? "npm.cmd" : "npm")).catch(() => undefined);
    if (resolved) candidates.push(resolved);
  }
  for (const candidate of candidates) if (typeof candidate === "string" && /npm-cli\.js$/.test(candidate) && await fs.access(candidate).then(() => true, () => false)) return candidate;
  throw new Error("Cannot locate npm-cli.js; supply --npm-cli FILE. npm is launched through Node without shell interpolation.");
}
try {
  check("temporary consumer is outside the repository", !within(temporaryRoot, workspace));
  record.tarballSha256 = crypto.createHash("sha256").update(await fs.readFile(tarball)).digest("hex");
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "leflect-standalone-api-consumer", version: "1.0.0", private: true }));
  const install = execute(process.execPath, [await npmCli(), "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball]);
  await fs.writeFile(path.join(temporaryRoot, "install.log"), `${install.stdout}${install.stderr}`);
  const packageRoot = path.join(consumer, "node_modules/leflect-java");
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  record.package = { name: packageJson.name, version: packageJson.version };
  const installed = (await fs.readdir(path.join(consumer, "node_modules"))).filter(name => !name.startsWith("."));
  check("one tarball installs exactly one runtime package", installed.length === 1 && installed[0] === "leflect-java", { installed });
  check("standalone package declares no missing external runtime dependencies", Object.keys(packageJson.dependencies ?? {}).length === 0);
  const entry = packageJson.exports?.["."];
  check("public main/types and conditional import/require entries are explicit", typeof packageJson.main === "string" && typeof packageJson.types === "string" &&
    typeof entry?.types === "string" && typeof entry?.import === "string" && typeof entry?.require === "string", { main: packageJson.main, types: packageJson.types, exports: packageJson.exports });
  for (const file of [packageJson.main, packageJson.types, entry.types, entry.import, entry.require]) {
    const target = path.resolve(packageRoot, file);
    check("public entry exists within installed package", within(target, packageRoot) && await fs.access(target).then(() => true, () => false), { entry: file });
  }
  const guide = await fs.readFile(path.join(packageRoot, "PARSER_API.md"));
  check("offline parser guide matches the documented contract", guide.equals(await fs.readFile(path.join(workspace, "docs/parser-api.md"))));
  check("installed README points to the bundled parser guide", (await fs.readFile(path.join(packageRoot, "README.md"), "utf8")).includes("PARSER_API.md"));
  const cli = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.leflect;
  check("explicit CLI help remains available", typeof cli === "string" && /Usage|Leflect|leflect/.test(execute(process.execPath, [path.resolve(packageRoot, cli), "--help"]).stdout));
  const fixtureRoot = path.join(workspace, "scripts/fixtures/npx-package");
  for (const file of ["purity-preload.cjs", "runtime.cjs", "runtime.mjs", "runtime-contract.cjs"]) await fs.copyFile(path.join(fixtureRoot, file), path.join(consumer, file));
  const source = path.join(consumer, "source");
  const xml = (uri, handler = "example.JarTag", attributes = "") => `<taglib><uri>${uri}</uri><tag><name>task</name><tag-class>${handler}</tag-class>${attributes}</tag></taglib>`;
  const write = async (file, value) => { const target = path.join(source, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value); };
  await write("repo/selected.tld", xml("urn:poc:selected", "example.SelectedTag", "<attribute><name>code</name><required>true</required></attribute>"));
  await write("repo/unselected.tld", xml("urn:poc:unselected"));
  await write("configured/selected.tld", xml("urn:poc:configured"));
  await write("configured/nested/recursive.tld", xml("urn:poc:recursive"));
  await write("unselected/deep/secret.tld", xml("urn:poc:secret"));
  await write("lib/ignored-loose.tld", xml("urn:poc:loose"));
  const AdmZip = createRequire(path.join(workspace, "packages/cli/package.json"))("adm-zip");
  async function jar(file, entries) {
    const archive = new AdmZip();
    for (const [name, content] of entries) archive.addFile(name, Buffer.from(content));
    await write(file, archive.toBuffer());
  }
  await jar("lib/selected.jar", [["META-INF/allowed.tld", xml("urn:poc:jar")], ["META-INF/duplicate.tld", xml("urn:poc:selected", "example.DuplicateTag")]]);
  await jar("lib/neighbor.jar", [["META-INF/neighbor.tld", xml("urn:poc:neighbor")]]);
  await jar("lib/nested/recursive.jar", [["META-INF/recursive.tld", xml("urn:poc:nested")]]);
  for (const file of ["runtime.cjs", "runtime.mjs"]) {
    const result = execute(process.execPath, ["--require", path.join(consumer, "purity-preload.cjs"), path.join(consumer, file)]);
    const value = JSON.parse(result.stdout);
    check("isolated runtime has no unaccounted stderr output", result.stderr === "", { mode: value.mode });
    record.runtime.push(value);
  }
  check("ESM and CommonJS expose identical function APIs", JSON.stringify(record.runtime[0].exportedFunctions) === JSON.stringify(record.runtime[1].exportedFunctions));
  const typeScriptRoot = path.dirname(require.resolve("typescript/package.json"));
  await fs.mkdir(path.dirname(tool), { recursive: true });
  await fs.cp(typeScriptRoot, tool, { recursive: true });
  const consumerSource = await fs.readFile(path.join(fixtureRoot, "consumer.ts"), "utf8");
  for (const extension of ["ts", "cts", "mts"]) await fs.writeFile(path.join(consumer, `consumer.${extension}`), consumerSource);
  for (const [name, module, resolution, files] of [
    ["Node16", "Node16", "Node16", ["consumer.cts", "consumer.mts"]],
    ["NodeNext", "NodeNext", "NodeNext", ["consumer.cts", "consumer.mts"]],
    ["CommonJS", "CommonJS", "Node", ["consumer.ts"]]
  ]) {
    const tsconfig = path.join(consumer, `tsconfig.${name}.json`);
    const options = { compilerOptions: { target: "ES2022", lib: ["ES2022"], module, moduleResolution: resolution,
      strict: true, skipLibCheck: false, noEmit: true, types: [], typeRoots: [] }, files };
    await fs.writeFile(tsconfig, JSON.stringify(options, null, 2));
    const compiled = execute(process.execPath, [path.join(tool, "bin/tsc"), "--project", tsconfig, "--listFiles", "--pretty", "false"]);
    await fs.writeFile(path.join(temporaryRoot, `typescript-${name}.log`), `${compiled.stdout}${compiled.stderr}`);
    const programFiles = compiled.stdout.split(/\r?\n/).filter(file => /\.d\.[cm]?ts$|\.[cm]?ts$/.test(file.trim())).map(file => file.trim());
    check("strict compiler has no parent/workspace declaration leakage", programFiles.length > 0 && programFiles.every(file => within(file, temporaryRoot)), { mode: name, files: programFiles.length });
    check("strict compiler includes the standalone public declaration", programFiles.some(file => canonical(file) === canonical(path.resolve(packageRoot, packageJson.types))), { mode: name });
    record.compilers.push({ mode: name, strict: true, skipLibCheck: false, types: [], typeRoots: [], exitCode: 0, files: programFiles });
  }
  record.passed = true;
} catch (error) {
  record.error = error instanceof Error ? error.stack : String(error);
  console.error(record.error);
  process.exitCode = 1;
} finally {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(record, null, 2) + "\n");
  if (!args.has("keep-temp")) {
    const resolved = await fs.realpath(temporaryRoot), temp = await fs.realpath(os.tmpdir());
    if (!within(resolved, temp) || !path.basename(resolved).startsWith("leflect-npx-package-")) throw new Error("Refusing to remove unexpected temporary directory");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ passed: record.passed, version: record.package?.version, checks: record.checks.length,
  runtimeChecks: record.runtime.reduce((count, runtime) => count + runtime.checks.length, 0), compilerModes: record.compilers.map(value => value.mode), report: reportPath,
  ...(args.has("keep-temp") ? { temporaryRoot } : {}) }));
