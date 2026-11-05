import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Historical findings select the 78 sites only. Expected expression types come
// exclusively from the supplied fresh javac attribution, never old findings.
// node scripts/verify-audit2-types.mjs --source PROJECT --out RUN --baseline OLD_RUN
//   [--javac TSV --metadata JSON --report JSON]
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/verify-audit2-types.mjs --source PROJECT --out RUN --baseline OLD_RUN [--javac TSV --metadata JSON --report JSON]\nExpected types come from fresh javac callType/callDeclaredType rows with hash-verified execution metadata. Exits 1 on a failed criterion.");
  process.exit(0);
}
const args = argumentsMap(process.argv.slice(2));
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of ["source", "out", "baseline"]) if (!args[name]) throw new Error(`Missing --${name}`);
const sourceRoot = path.resolve(args.source);
const outRoot = path.resolve(args.out);
const baselineRoot = path.resolve(args.baseline);
const javacPath = path.resolve(args.javac ?? path.join(outRoot, "verification/java-symbols/source.tsv"));
const metadataPath = path.resolve(args.metadata ?? path.join(path.dirname(javacPath), "metadata.json"));
const reportPath = path.resolve(args.report ?? path.join(outRoot, "verification/audit2-types.json"));
const metadata = readJson(metadataPath);
const sourceText = fs.readFileSync(javacPath, "utf8");
const rows = sourceText.trim().split(/\r?\n/).filter(Boolean).map(line => {
  const [kind, file, lineNumber, column, endLine, endColumn, type, signature, erasedSignature, name] = line.split("\t");
  return { kind, file, location: { line: Number(lineNumber), column: Number(column), endLine: Number(endLine), endColumn: Number(endColumn) },
    type, signature, erasedSignature, name };
});
const findings = readJson(path.join(workspace, "docs/audits/legacy-bank-java8-source-audit-20261105/findings.json"));
const finding = findings.scopeReviews.find(item => item.key === "REVIEW-TYPE-01");
const current = readMetadata(outRoot).flatMap(file => file.calls);
const old = readMetadata(baselineRoot).flatMap(file => file.calls);
const checks = [];
const add = (name, passed, evidence = {}) => checks.push({ name, passed: Boolean(passed), ...evidence });
add("fresh independent javac attribution completed", metadata.exitCode === 0 && Boolean(metadata.generatedAt) && Boolean(metadata.command),
  { exitCode: metadata.exitCode, generatedAt: metadata.generatedAt, command: metadata.command });
add("fresh javac TSV matches execution metadata", metadata.tsvSha256 === sha256(fs.readFileSync(javacPath)),
  { expected: metadata.tsvSha256, actual: sha256(fs.readFileSync(javacPath)) });
add("fresh javac covers 42 original Java files", Array.isArray(metadata.sourceFiles) && metadata.sourceFiles.length === 42,
  { sourceFiles: metadata.sourceFiles?.length });
for (const entry of metadata.sourceFiles ?? []) {
  const candidate = path.resolve(sourceRoot, entry.path);
  const safe = candidate.startsWith(`${sourceRoot}${path.sep}`);
  const actual = safe && fs.existsSync(candidate) ? sha256(fs.readFileSync(candidate)) : undefined;
  add("javac input hash matches current original source", safe && actual === entry.sha256,
    { file: entry.path, expected: entry.sha256, actual });
}
add("78 historical sites selected without historical expected types", finding.occurrences.length === 78,
  { selected: finding.occurrences.length, expectationSource: javacPath });
for (const site of finding.occurrences) {
  const calls = current.filter(call => call.fromFile === site.file && locationKey(call.location) === locationKey(site.location));
  const oracle = rows.filter(row => row.kind === "callType" && row.file === site.file && locationKey(row.location) === locationKey(site.location));
  const call = calls[0], expected = oracle[0];
  const actualSource = sourceSpan(site.file, site.location);
  add("78 concrete expression types match fresh javac", calls.length === 1 && oracle.length === 1 &&
    call.expressionTypeStatus === "resolved" && normalizeType(call.expressionType) === normalizeType(expected.type) &&
    compact(actualSource) === compact(call.snippet),
  { file: site.file, location: site.location, source: actualSource,
    expected: expected?.type, actual: call?.expressionType, status: call?.expressionTypeStatus, reason: call?.expressionTypeReason });
}
for (const previous of old) {
  const calls = current.filter(call => call.fromFile === previous.fromFile && locationKey(call.location) === locationKey(previous.location));
  const call = calls[0];
  add("legacy responseType and canonical target preserved", calls.length === 1 &&
    compact(call.resolvedMethodId) === compact(previous.resolvedMethodId) && call.responseType === previous.responseType,
  { file: previous.fromFile, location: previous.location,
    expected: { responseType: previous.responseType, resolvedMethodId: previous.resolvedMethodId },
    actual: { responseType: call?.responseType, resolvedMethodId: call?.resolvedMethodId } });
  if (!call) continue;
  const declarations = rows.filter(row => row.kind === "callDeclaredType" && row.file === previous.fromFile && locationKey(row.location) === locationKey(previous.location));
  add("declaration return type matches fresh javac symbol", call.invocationKind
    ? call.expressionTypeStatus === "not-applicable" && !call.declaredReturnType
    : declarations.length === 1 && normalizeType(call.declaredReturnType) === normalizeType(declarations[0].type),
  { file: previous.fromFile, location: previous.location, expected: declarations[0]?.type, actual: call.declaredReturnType });
  add("expression type has honest resolution status", ['resolved', 'partial', 'unresolved', 'not-applicable'].includes(call.expressionTypeStatus) &&
    (call.expressionTypeStatus === "resolved" ? Boolean(call.expressionType) : Boolean(call.expressionTypeReason)),
  { file: previous.fromFile, location: previous.location, type: call.expressionType, status: call.expressionTypeStatus, reason: call.expressionTypeReason });
}
add("646 calls retain output contracts", old.length === 646 && current.length === 646, { baseline: old.length, current: current.length });
const report = {
  generatedAt: new Date().toISOString(), sourceRoot, outRoot, baselineRoot, javacPath, metadataPath,
  methodology: "The 78 historical ranges select sites only. Expected expression types and declaration return types are obtained from this run's independent javac callType/callDeclaredType rows. All 646 legacy response types and canonical targets are compared with the baseline. No reflection target is inferred from capture variables.",
  passed: checks.every(check => check.passed),
  summary: { checks: checks.length, passedChecks: checks.filter(check => check.passed).length, failedChecks: checks.filter(check => !check.passed).length,
    historicalSites: finding.occurrences.length, currentCalls: current.length, javacCallTypes: rows.filter(row => row.kind === "callType").length,
    javacDeclarationTypes: rows.filter(row => row.kind === "callDeclaredType").length,
    expressionStatuses: counts(current, call => call.expressionTypeStatus) },
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
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function compact(value) { return (value ?? "").replace(/\s+/g, ""); }
function normalizeType(value) { return compact(value).replace(/\$/g, "."); }
function locationKey(location) { return [location?.line, location?.column, location?.endLine, location?.endColumn].join(":"); }
function counts(values, key) { const result = {}; for (const value of values) result[key(value)] = (result[key(value)] ?? 0) + 1; return result; }
function sourceSpan(file, location) {
  const candidate = path.resolve(sourceRoot, file);
  if (!candidate.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Source path escapes project: ${file}`);
  const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/);
  if (location.line === location.endLine) return (lines[location.line - 1] ?? "").slice(location.column - 1, location.endColumn);
  return [(lines[location.line - 1] ?? "").slice(location.column - 1), ...lines.slice(location.line, location.endLine - 1),
    (lines[location.endLine - 1] ?? "").slice(0, location.endColumn)].join("\n");
}
