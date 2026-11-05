"use strict";
const fs = require("node:fs"), fsp = require("node:fs/promises");
const path = require("node:path"), cp = require("node:child_process"), Module = require("node:module");
const { fileURLToPath } = require("node:url");
let phase = "import", allowedFiles = new Set(), allowedDirectories = [];
const records = [], blocked = [], output = [], restore = [];
const normalize = value => {
  if (typeof value !== "string" && !(value instanceof URL)) return `<${typeof value}>`;
  const resolved = path.resolve(value instanceof URL ? fileURLToPath(value) : value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const within = (value, folder) => value === folder || value.startsWith(folder + path.sep);
const packageRoot = normalize(path.join(process.cwd(), "node_modules/leflect-java"));
const loaderFiles = new Set(["runtime.cjs", "runtime.mjs", "runtime-contract.cjs", "purity-preload.cjs", "package.json"]
  .map(file => normalize(path.join(process.cwd(), file))));
function permit(method, value) {
  const file = normalize(value), mutation = /write|append|mkdir|unlink|rename|rm|rmdir|copy|truncate|symlink/i.test(method);
  if (mutation) return false;
  if (phase === "import") return !/readdir|opendir|glob/i.test(method) && /\.(?:[cm]?js|json)$/.test(file) &&
    (within(file, packageRoot) || loaderFiles.has(file));
  if (phase === "pure" || phase === "empty") return false;
  return allowedFiles.has(file) || allowedDirectories.some(folder => within(file, folder));
}
function wrap(holder, key, label) {
  if (typeof holder[key] !== "function") return;
  const original = holder[key];
  const wrapped = function (...args) {
    const record = { phase, method: label, path: String(args[0]) };
    records.push(record);
    if (!permit(label, args[0])) { blocked.push(record); throw new Error(`Unexpected filesystem operation: ${phase} ${label} ${args[0]}`); }
    return Reflect.apply(original, this, args);
  };
  if (original.native) wrapped.native = wrapped;
  holder[key] = wrapped;
  restore.push(() => { holder[key] = original; });
}
for (const key of ["readdir", "readdirSync", "opendir", "opendirSync", "glob", "globSync", "readFile", "readFileSync", "stat", "statSync", "lstat", "lstatSync", "access", "accessSync", "existsSync", "realpath", "realpathSync", "writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "unlink", "unlinkSync", "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "copyFile", "copyFileSync"])
  wrap(fs, key, `fs.${key}`);
for (const key of ["readdir", "opendir", "glob", "readFile", "stat", "lstat", "access", "realpath", "writeFile", "appendFile", "mkdir", "unlink", "rename", "rm", "rmdir", "copyFile"])
  wrap(fsp, key, `fs/promises.${key}`);
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = cp[key];
  cp[key] = (...args) => { const record = { phase, method: `child_process.${key}`, path: String(args[0]) }; blocked.push(record); throw new Error("Parser API started a child process"); };
  restore.push(() => { cp[key] = original; });
}
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (String(request).startsWith("@leflect-java/")) throw new Error(`External workspace package leaked: ${request}`);
  return Reflect.apply(resolve, this, [request, ...args]);
};
restore.push(() => { Module._resolveFilename = resolve; });
for (const [name, stream] of [["stdout", process.stdout], ["stderr", process.stderr]]) {
  const original = stream.write;
  stream.write = function (chunk, ...args) { output.push({ phase, stream: name, text: String(chunk) }); const callback = args.find(arg => typeof arg === "function"); if (callback) callback(); return true; };
  restore.push(() => { stream.write = original; });
}
globalThis.__leflectPackageProbe = {
  phase(name, files = [], directories = []) {
    phase = name; allowedFiles = new Set(files.map(normalize)); allowedDirectories = directories.map(normalize);
    return records.length;
  },
  since(start) { return records.slice(start); },
  finish() { while (restore.length) restore.pop()(); return { records, blocked, output }; }
};
