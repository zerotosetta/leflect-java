import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Sample-specific acceptance: source positions and import origins are checked
// independently of the indexer's matching implementation.
// node scripts/verify-audit2-imports.mjs --source PROJECT --out RUN --baseline OLD_RUN [--report FILE]
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/verify-audit2-imports.mjs --source PROJECT --out RUN --baseline OLD_RUN [--report FILE]\nVerifies the legacy-bank-java8 AUD2 import criteria; writes all checks and exits 1 on a failed criterion.");
  process.exit(0);
}
const args = argumentsMap(process.argv.slice(2));
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of ["source", "out", "baseline"]) if (!args[name]) throw new Error(`Missing --${name}`);
const sourceRoot = path.resolve(args.source);
const outRoot = path.resolve(args.out);
const baselineRoot = path.resolve(args.baseline);
const reportPath = path.resolve(args.report ?? path.join(outRoot, "verification/audit2-imports.json"));
const findings = readJson(path.join(workspace, "docs/audits/legacy-bank-java8-source-audit-20261105/findings.json"));
const finding = findings.confirmed.find(item => item.key === "AUD2-IMPORT-02");
const files = readMetadata(outRoot);
const oldFiles = readMetadata(baselineRoot);
const sourceCache = new Map();
const checks = [];
const add = (name, passed, evidence = {}) => checks.push({ name, passed: Boolean(passed), ...evidence });
const allRefs = files.flatMap(file => file.classReferences);
const allCalls = files.flatMap(file => file.calls);
const oldRefs = oldFiles.flatMap(file => file.classReferences);
const oldCalls = oldFiles.flatMap(file => file.calls);
const byFile = new Map(files.map(file => [file.path, file]));

add("historical source scope", files.length === 42 && allRefs.length === 966 && allCalls.length === 646,
  { actual: { files: files.length, references: allRefs.length, calls: allCalls.length }, expected: { files: 42, references: 966, calls: 646 } });
const hashes = readJson(path.join(workspace, "docs/audits/legacy-bank-java8-rebuild-20261105/environment.json")).sourceHashes;
for (const expected of hashes) {
  const candidate = path.resolve(sourceRoot, expected.path);
  const actual = fs.existsSync(candidate) ? crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex") : undefined;
  add("original input hash", actual === expected.sha256, { file: expected.path, expected: expected.sha256, actual });
}
sameMultiset("raw reference identity and target preservation", oldRefs, allRefs, ref =>
  [ref.file, ref.kind, locationKey(ref.location), ref.className, ref.qualifiedName, ref.resolvedClassId].join("|"));
sameMultiset("call identity and target preservation", oldCalls, allCalls, call =>
  [call.fromFile, call.fromMethodId, locationKey(call.location), compact(call.resolvedMethodId ?? call.toMethodId), call.resolvedClassId].join("|"));

let importCount = 0;
let wildcardCount = 0;
for (const file of files) {
  const declarations = scanImports(source(file.path));
  importCount += declarations.length;
  wildcardCount += declarations.filter(item => item.wildcard).length;
  sameMultiset(`source import declarations: ${file.path}`, declarations, file.importEntries,
    item => importIdentity(item.import ?? item.spelling));
  for (const declaration of declarations) {
    const entries = file.importEntries.filter(entry => importIdentity(entry.import) === importIdentity(declaration.spelling));
    const entry = entries[0];
    add("import identity and exact full declaration range", entries.length === 1 &&
      entry.id === `java-import:${file.path}:${entry.import}` && locationKey(entry.location) === locationKey(declaration.location),
    { file: file.path, source: declaration.spelling, expectedLocation: declaration.location, actual: entry });
    const refs = file.classReferences.filter(ref => ref.kind?.startsWith("import") && locationKey(ref.location) === locationKey(declaration.location));
    add("import declaration self ID", refs.length === 1 && refs[0].importId === entry?.id && refs[0].originKind === "import-declaration" && refs[0].originStatus === "resolved" &&
      compact(refs[0].snippet) === compact(span(file.path, declaration.location)),
      { file: file.path, location: declaration.location, expectedImportId: entry?.id, actual: refs });
  }
  for (const ref of file.classReferences.filter(ref => !ref.kind?.startsWith("import"))) {
    const spelling = span(file.path, ref.location);
    const expectation = sourceImportExpectation(file, ref.resolvedClassId ?? ref.qualifiedName, spelling);
    add("source-backed type reference and import origin", compact(spelling) === compact(ref.snippet) &&
      sameNullable(ref.importId, expectation.importId) && ref.originKind === expectation.kind && ref.originStatus === expectation.status,
    { file: file.path, location: ref.location, source: spelling, target: ref.qualifiedName,
      expected: expectation, actual: { importId: ref.importId, originKind: ref.originKind, originStatus: ref.originStatus } });
  }
}
add("154 exact imports including 116 wildcard declarations", importCount === 154 && wildcardCount === 116, { importCount, wildcardCount });

for (const site of finding.occurrences) {
  const matches = allRefs.filter(ref => ref.file === site.file && ref.kind === site.kind && locationKey(ref.location) === locationKey(site.location));
  add("historical 20 type reference findings", matches.length === 1 && matches[0].importId === site.expectedImportId &&
    compact(matches[0].resolvedClassId ?? matches[0].qualifiedName) === compact(site.target),
    { file: site.file, location: site.location, source: span(site.file, site.location), expectedImportId: site.expectedImportId, actual: matches });
}
let directHistoricalCalls = 0;
let chainedHistoricalCalls = 0;
for (const site of finding.associatedCallObservations) {
  const matches = allCalls.filter(call => call.fromFile === site.file && locationKey(call.location) === locationKey(site.location));
  const call = matches[0];
  const chained = /\)\s*\./.test(span(site.file, site.location));
  if (chained) chainedHistoricalCalls++; else directHistoricalCalls++;
  add("historical 14 call origins follow actual source receiver", matches.length === 1 &&
    compact(call.resolvedMethodId) === compact(site.target) && (chained
      ? call.originKind === "receiver-call" && call.originStatus === "not-required" && !call.importId
      : call.originKind === "receiver-declaration" && call.originStatus === "resolved" && call.importId === site.expectedMatchingImportId),
  { file: site.file, location: site.location, source: span(site.file, site.location),
    expected: chained ? "receiver-call, no importId" : site.expectedMatchingImportId, actual: call });
}
add("historical call receiver partition", directHistoricalCalls === 11 && chainedHistoricalCalls === 3, { directHistoricalCalls, chainedHistoricalCalls });

for (const call of allCalls) {
  const evidence = call.originEvidence;
  add("all calls have explicit origin classification", call.originKind && call.originStatus && evidence &&
    (!['unresolved', 'ambiguous'].includes(call.originStatus) || Boolean(evidence.reason)),
  { file: call.fromFile, location: call.location, originKind: call.originKind, originStatus: call.originStatus, evidence });
  if (["receiver-call", "inherited", "local-type"].includes(call.originKind)) {
    add("implicit and expression receiver origins do not borrow imports", !call.importId && call.originStatus === "not-required",
      { file: call.fromFile, location: call.location, originKind: call.originKind, importId: call.importId, originStatus: call.originStatus });
  }
  const declarationFile = byFile.get(evidence?.file);
  const writtenDeclaration = evidence?.file && evidence.location ? span(evidence.file, evidence.location) : "";
  const expectation = declarationFile ? call.originKind === "static-import"
    ? sourceStaticImportExpectation(declarationFile, evidence.type, evidence.spelling)
    : sourceImportExpectation(declarationFile, evidence.type, evidence.spelling) : undefined;
  if (["receiver-declaration", "static-owner", "static-import"].includes(call.originKind)) {
    const sameFile = evidence?.file === call.fromFile;
    add("known receiver declaration supplies exactly its source import", sameFile
      ? sameNullable(call.importId, expectation?.importId) && call.originStatus === expectation?.status
      : !call.importId && call.originStatus === "not-required",
    { file: call.fromFile, location: call.location, evidence, expected: sameFile ? expectation : "other-file declaration, no current-file import",
      actual: { importId: call.importId, originStatus: call.originStatus } });
  }
  if (!call.importId) continue;
  const sourceVerified = call.originKind === "static-owner"
    ? compact(span(call.fromFile, call.location)).startsWith(`${compact(evidence.spelling)}.`)
    : call.originKind === "static-import"
      ? compact(span(call.fromFile, call.location)).startsWith(`${compact(evidence.spelling)}(`) &&
        /^\s*import\s+static\s+/.test(writtenDeclaration)
      : Boolean(writtenDeclaration && compact(writtenDeclaration).includes(compact(evidence.spelling)));
  add("every call import has source declaration evidence", evidence?.file === call.fromFile && expectation?.importId === call.importId &&
    call.originStatus === "resolved" && sourceVerified,
  { file: call.fromFile, location: call.location, source: span(call.fromFile, call.location), importId: call.importId,
    declarationSource: writtenDeclaration, evidence, expected: expectation });
}
const previouslyUnlinked = oldCalls.filter(call => !call.importId);
add("199 previously unlinked calls remain individually classified", previouslyUnlinked.length === 199 && previouslyUnlinked.every(old => {
  const call = allCalls.find(current => current.fromFile === old.fromFile && locationKey(current.location) === locationKey(old.location));
  return call?.originKind && call?.originStatus && call?.originEvidence;
}), { expected: 199, actual: previouslyUnlinked.length });
const fullyQualified = allRefs.filter(ref => ref.originKind === "fully-qualified");
add("five FQN source uses have no heuristic imports", fullyQualified.length === 5 && fullyQualified.every(ref => !ref.importId), { count: fullyQualified.length });
const report = {
  generatedAt: new Date().toISOString(), sourceRoot, outRoot, baselineRoot,
  methodology: "Original Java lexical import scan and inclusive source spans; historical findings select regression sites; baseline is used only for identity/target preservation. Call import checks use actual declaration source and receiver provenance, not the callee owner's package. Unresolved origins are reported explicitly, not counted as missing imports.",
  passed: checks.every(check => check.passed),
  summary: { checks: checks.length, passedChecks: checks.filter(check => check.passed).length, failedChecks: checks.filter(check => !check.passed).length,
    files: files.length, imports: importCount, wildcardImports: wildcardCount, rawReferences: allRefs.length, calls: allCalls.length,
    callOrigins: countBy(allCalls, call => `${call.originKind}:${call.originStatus}`) },
  failures: checks.filter(check => !check.passed), checks
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, passed: report.passed, report: reportPath }, null, 2));
if (!report.passed) process.exitCode = 1;

function argumentsMap(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 2) {
    if (!values[i].startsWith("--") || !values[i + 1]) throw new Error("Arguments must be --name value pairs");
    result[values[i].slice(2)] = values[i + 1];
  }
  return result;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readMetadata(root) {
  const indexRoot = path.join(root, "index");
  return readJson(path.join(indexRoot, "java-files.json")).map(file => readJson(path.join(indexRoot, file.metadataPath)));
}
function source(file) {
  const candidate = path.resolve(sourceRoot, file);
  if (!candidate.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Source path escapes project: ${file}`);
  if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(candidate, "utf8"));
  return sourceCache.get(file);
}
function span(file, location) {
  if (!location?.line || !location?.endLine) return "";
  const lines = source(file).split(/\r?\n/);
  if (location.line === location.endLine) return (lines[location.line - 1] ?? "").slice(location.column - 1, location.endColumn);
  return [(lines[location.line - 1] ?? "").slice(location.column - 1), ...lines.slice(location.line, location.endLine - 1),
    (lines[location.endLine - 1] ?? "").slice(0, location.endColumn)].join("\n");
}
function locationKey(location) { return [location?.line, location?.column, location?.endLine, location?.endColumn].join(":"); }
function compact(value) { return (value ?? "").replace(/\s+/g, ""); }
function sameNullable(a, b) { return (a ?? null) === (b ?? null); }
function countBy(values, key) { const counts = {}; for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1; return counts; }
function sameMultiset(name, expected, actual, key) {
  const e = countBy(expected, key), a = countBy(actual, key);
  const difference = [...new Set([...Object.keys(e), ...Object.keys(a)])].filter(item => e[item] !== a[item]).map(item => ({ key: item, expected: e[item] ?? 0, actual: a[item] ?? 0 }));
  add(name, difference.length === 0, { expected: expected.length, actual: actual.length, difference });
}
// Older summary import IDs omit static. Its original spelling is verified on
// the raw declaration at the exact source range instead of rewriting that ID.
function importIdentity(spelling) { return compact(spelling).replace(/^import/, "").replace(/^static/, "").replace(/;$/, ""); }
function maskJava(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    token => token.replace(/[^\r\n]/g, " "));
}
function scanImports(text) {
  const masked = maskJava(text);
  return [...masked.matchAll(/\bimport\s+(static\s+)?([\w$]+(?:\s*\.\s*(?:[\w$]+|\*))*)\s*;/g)].map(match => {
    const start = match.index, end = start + match[0].length - 1;
    const position = offset => { const prefix = text.slice(0, offset); const lines = prefix.split("\n"); return { line: lines.length, column: lines.at(-1).length + 1 }; };
    const a = position(start), b = position(end);
    const name = compact(match[2]);
    return { spelling: `${match[1] ? "static " : ""}${name}`, isStatic: Boolean(match[1]), wildcard: name.endsWith(".*"),
      name: name.replace(/\.\*$/, ""), location: { line: a.line, column: a.column, endLine: b.line, endColumn: b.column } };
  });
}
function baseType(type) {
  return compact((type ?? "").replace(/<[^<>]*>/g, "<>").replace(/(?:<[^<>]*>)+/g, ""))
    .replace(/(?:\[\]|\.\.\.)/g, "").replace(/\$/g, ".");
}
function sourceImportExpectation(file, resolved, written) {
  const stripGenerics = value => { let result = value ?? ""; while (/<[^<>]*>/.test(result)) result = result.replace(/<[^<>]*>/g, ""); return baseType(result); };
  const type = stripGenerics(resolved), spelling = stripGenerics(written);
  const noImport = kind => ({ kind, status: "not-required" });
  if (type === spelling && spelling.includes(".")) return noImport("fully-qualified");
  if (file.classes.some(item => item.id.replace(/\$/g, ".") === type)) return noImport("local-type");
  const imports = scanImports(source(file.path));
  const [outer, ...members] = spelling.split(".");
  const singles = imports.filter(item => !item.wildcard && item.name.split(".").at(-1) === outer && [item.name, ...members].join(".") === type);
  const link = (candidates, kind) => candidates.length === 1
    ? { kind, status: "resolved", importId: file.importEntries.find(entry => importIdentity(entry.import) === importIdentity(candidates[0].spelling))?.id }
    : { kind: "ambiguous", status: "ambiguous" };
  if (singles.length) return link(singles, "explicit-import");
  const owner = type.endsWith(`.${spelling}`) ? type.slice(0, -spelling.length - 1) : undefined;
  if (owner === file.packageName) return noImport("same-package");
  if (owner === "java.lang") return noImport("java-lang");
  const onDemand = imports.filter(item => item.wildcard && item.name === owner);
  return onDemand.length ? link(onDemand, "on-demand-import") : { kind: "unresolved", status: "unresolved" };
}
function sourceStaticImportExpectation(file, owner, method) {
  const candidates = scanImports(source(file.path)).filter(item => item.isStatic &&
    (item.wildcard ? item.name === owner : item.name === `${owner}.${method}`));
  if (candidates.length !== 1) return { kind: candidates.length ? "ambiguous" : "unresolved", status: candidates.length ? "ambiguous" : "unresolved" };
  return { kind: "static-import", status: "resolved",
    importId: file.importEntries.find(entry => importIdentity(entry.import) === importIdentity(candidates[0].spelling))?.id };
}
