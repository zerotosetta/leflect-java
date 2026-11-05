import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Source-specific acceptance. The independent javac inventory is bound to the exact
// original files by hashes and inclusive source spans, never by generated step IDs.
// node scripts/verify-audit2-execution.mjs --source PROJECT --out RUN --baseline OLD_RUN [--report FILE]
const args = argumentsMap(process.argv.slice(2));
for (const key of ["source", "out", "baseline"]) if (!args[key]) throw new Error(`Missing --${key}`);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(args.source), outRoot = path.resolve(args.out), baselineRoot = path.resolve(args.baseline);
const reportPath = path.resolve(args.report ?? path.join(outRoot, "verification/audit2-execution.json"));
const inventoryRoot = path.join(baselineRoot, "source-audit/java-execution");
const historical = json(path.join(inventoryRoot, "comparison.json"));
const freshInventoryPath = path.join(outRoot, "verification/java-execution/source.tsv");
const freshInventoryAvailable = fs.existsSync(freshInventoryPath);
const files = metadata(outRoot), oldFiles = metadata(baselineRoot);
const methods = files.flatMap(f => f.methods.map(m => ({ ...m, file: f.path })));
const oldMethods = oldFiles.flatMap(f => f.methods.map(m => ({ ...m, file: f.path })));
const byMethod = new Map(methods.map(m => [`${m.file}|${m.id}`, m]));
const rows = fs.readFileSync(freshInventoryAvailable ? freshInventoryPath : path.join(inventoryRoot, "source.tsv"), "utf8").trim().split(/\r?\n/).map(line => {
  const [kind, file, owner, methodName, methodStart, start, end, a, b, c, d, text, extra, guards] = line.split("\t");
  const decode = value => Buffer.from(value ?? "", "base64").toString("utf8");
  return { kind, file, owner, methodName, methodStart: +methodStart, start: +start, end: +end,
    location: { line: +a, column: +b, endLine: +c, endColumn: +d }, source: decode(text), extra: decode(extra), guards: decode(guards) };
});
const sourceCache = new Map(), checks = [];
const add = (name, passed, evidence = {}) => checks.push({ name, passed: Boolean(passed), ...evidence });
const allSteps = methods.flatMap(m => (m.executionModel?.orderedSteps ?? []).map(s => ({ ...s, file: m.file, methodId: m.id })));
const inventoryMethods = rows.filter(r => r.kind === "method");
const methodFor = row => methods.find(m => m.file === row.file && contains(m.location, row.location));
const mappings = { call: ["call"], "constructor-call": ["constructor-call"], instantiate: ["instantiate"], return: ["return"], throw: ["throw"],
  if: ["branch"], ternary: ["branch"], try: ["branch"], for: ["loop"], "for-each": ["loop"], while: ["loop"], do: ["loop"], switch: ["branch"],
  synchronized: ["synchronized"], assignment: ["assignment", "field-write"], "compound-assignment": ["assignment", "field-write"] };
const exact = (m, row, kinds, legacy = false) => (legacy ? m?.orderedSteps : m?.executionModel?.orderedSteps ?? [])?.filter(s => kinds.includes(s.kind) && rangeKey(s.lineRange) === rangeKey(row.location)) ?? [];

add("42 files and 108 explicit methods", files.length === 42 && methods.length === 108 && inventoryMethods.length === 108,
  { actual: { files: files.length, methods: methods.length, inventoryMethods: inventoryMethods.length } });
add("fresh independent JDK source inventory available", freshInventoryAvailable && /Source files=42, compiler errors=0/.test(fs.readFileSync(path.join(outRoot, "verification/java-execution/run.log"), "utf8")),
  { inventory: freshInventoryAvailable ? freshInventoryPath : "historical inventory used for preliminary diagnostics only" });
for (const hash of json(path.join(workspace, "docs/audits/legacy-bank-java8-rebuild-20261105/environment.json")).sourceHashes) {
  const candidate = path.resolve(sourceRoot, hash.path);
  const actual = fs.existsSync(candidate) ? crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex") : undefined;
  add("original input hash", actual === hash.sha256, { file: hash.path, expected: hash.sha256, actual });
}
for (const row of rows) add("javac inventory inclusive source span", span(row.file, row.location) === row.source,
  { file: row.file, kind: row.kind, location: row.location, expected: row.source, actual: span(row.file, row.location) });

const historicalComparisons = historical.methods.flatMap(m => m.comparisons.map(r => ({ ...r, file: m.file, methodId: m.methodId })));
add("historical 1149 operation positions selected", historicalComparisons.length === 1149, { actual: historicalComparisons.length });
for (const row of historicalComparisons) {
  const m = byMethod.get(`${row.file}|${row.methodId}`), expectedKinds = mappings[row.kind];
  const v2 = exact(m, row, expectedKinds), legacy = exact(m, row, expectedKinds, true);
  add("historical operation role and exact range preserved in legacy and v2", v2.length === 1 && legacy.length === 1 && compact(span(row.file, row.location)) === compact(row.source),
    { file: row.file, methodId: row.methodId, kind: row.kind, location: row.location, source: row.source, v2: v2.map(s => s.id), legacy: legacy.map(s => s.id) });
}

for (const m of methods) {
  const model = m.executionModel, old = oldMethods.find(o => o.id === m.id && o.file === m.file);
  add("legacy operation semantics unchanged", Boolean(old) && JSON.stringify((old.orderedSteps ?? []).map(legacyIdentity)) === JSON.stringify((m.orderedSteps ?? []).map(legacyIdentity)),
    { file: m.file, methodId: m.id });
  add("method-local v2 complete source coverage", model?.version === 2 && model.methodId === m.id && model.coverage?.status === "complete" && model.coverage.unsupportedNodes?.length === 0 && model.coverage.stateAnalysis?.status === "complete",
    { file: m.file, methodId: m.id, coverage: model?.coverage });
  if (!model) continue;
  const graph = model.flowGraph, nodes = new Map(graph.nodes.map(n => [n.id, n])), conditions = new Map(graph.conditions.map(c => [c.id, c])), symbols = new Map(model.symbols.map(s => [s.id, s]));
  const nodeStates = new Map(model.states.map(s => [s.nodeId, s]));
  add("CFG endpoint closure and one state snapshot per node", nodes.size === graph.nodes.length && nodes.has(graph.entryNodeId) && graph.exitNodeIds.every(id => nodes.has(id)) &&
    graph.edges.every(e => nodes.has(e.from) && nodes.has(e.to)) && nodeStates.size === nodes.size && model.states.length === nodes.size && [...nodes.keys()].every(id => nodeStates.has(id)),
    { file: m.file, methodId: m.id, nodes: nodes.size, edges: graph.edges.length, states: model.states.length });
  add("source steps are canonical and linked to graph", new Set(model.orderedSteps.map(s => s.id)).size === model.orderedSteps.length &&
    new Set(model.orderedSteps.map(s => `${s.kind}|${rangeKey(s.lineRange)}|${s.declaration?.name ?? ""}`)).size === model.orderedSteps.length &&
    model.orderedSteps.every(s => nodes.get(s.flowNodeId)?.stepId === s.id && contains(m.location, s.lineRange)),
    { file: m.file, methodId: m.id, steps: model.orderedSteps.length });
  add("guards and effects point to actual conditions and declared symbols", model.orderedSteps.every(s =>
    Array.isArray(s.guardRefs) && Array.isArray(s.guards) && JSON.stringify(s.guardRefs) === JSON.stringify(s.guards.map(g => g.id)) &&
    s.guards.every(g => conditions.has(g.conditionId) && typeof g.when === "boolean" && compact(span(m.file, g.lineRange)) === compact(g.expression)) &&
    (!s.declaration?.symbolId || symbols.has(s.declaration.symbolId)) && (s.effects ?? []).every(e => !e.target?.symbolId || symbols.has(e.target.symbolId))),
    { file: m.file, methodId: m.id });
  add("finite state lattice and support boundaries explicit", model.states.every(s => [s.before, s.after].every(values => Object.entries(values).every(([id, state]) => symbols.has(id) &&
    ["uninitialized", "initialized", "maybe-uninitialized", "unknown"].includes(state.initialization) && ["null", "non-null", "maybe-null", "unknown", "not-applicable"].includes(state.nullability)))) &&
    model.coverage.stateAnalysis.completionSensitive === true && model.coverage.stateAnalysis.concreteValueCalculation === false && model.coverage.limits.length > 0,
    { file: m.file, methodId: m.id });
  const inputCalls = rows.filter(r => r.kind === "call" && r.methodStart >= 0 && methodFor(r)?.id === m.id);
  add("source invocation evaluation order retained", JSON.stringify(inputCalls.map(r => rangeKey(r.location))) === JSON.stringify(model.orderedSteps.filter(s => s.kind === "call").map(s => rangeKey(s.lineRange))),
    { file: m.file, methodId: m.id, expected: inputCalls.map(r => rangeKey(r.location)), actual: model.orderedSteps.filter(s => s.kind === "call").map(s => rangeKey(s.lineRange)) });
}

const declarations = rows.filter(r => r.methodStart >= 0 && ["local-variable", "uninitialized-local"].includes(r.kind));
const uninitialized = declarations.filter(r => r.kind === "uninitialized-local");
const localSteps = allSteps.filter(s => s.kind === "declaration" && s.declaration.initializationKind === "local");
add("156 local declarations including 12 without initializer", declarations.length === 156 && localSteps.length === 156 && uninitialized.length === 12,
  { sourceDeclarations: declarations.length, v2Declarations: localSteps.length, sourceUninitialized: uninitialized.length });
for (const row of declarations) {
  const m = methodFor(row), matches = (m?.executionModel?.orderedSteps ?? []).filter(s => s.kind === "declaration" && s.declaration.name === row.extra && contains(row.location, s.declaration.nameRange));
  const step = matches[0], symbolId = step?.declaration.symbolId, snapshot = m?.executionModel?.states.find(s => s.nodeId === step?.flowNodeId);
  const sourceName = step ? span(row.file, step.declaration.nameRange) : undefined;
  add("local declaration name owner and separate declaration/name ranges", matches.length === 1 && sourceName === row.extra && contains(step.lineRange, step.declaration.nameRange) &&
    contains(m.location, step.lineRange) && Boolean(step.declaration.hasInitializer) === (row.kind !== "uninitialized-local") && Boolean(symbolId),
    { file: row.file, methodId: m?.id, location: row.location, source: row.source, actual: step?.declaration, declarationRange: step?.lineRange });
  if (row.kind === "uninitialized-local") add("uninitialized declaration creates no initialization write", snapshot?.after[symbolId]?.initialization === "uninitialized" &&
    !(m.executionModel.orderedSteps ?? []).some(s => s.assignmentKind === "initialization" && s.symbolId === symbolId),
    { file: row.file, methodId: m?.id, location: row.location, source: row.source, state: snapshot?.after[symbolId] });
}

const mutations = rows.filter(r => r.kind === "mutation" && r.methodStart >= 0);
add("four source mutation effects without duplicate assignment", mutations.length === 4 && allSteps.filter(s => s.kind === "mutation").length === 4, { source: mutations.length, v2: allSteps.filter(s => s.kind === "mutation").length });
for (const row of mutations) {
  const m = methodFor(row), matches = exact(m, row, ["mutation"]), step = matches[0], effect = step?.effects?.[0];
  add("mutation target operator old/new value and exact range", matches.length === 1 && step.effects.length === 1 && effect.operator === row.extra && effect.reads && effect.writes &&
    effect.evaluationCount === 1 && effect.resultMode === (row.extra.startsWith("POSTFIX") ? "previous-value" : "updated-value") &&
    effect.target.symbolId && effect.target.resolutionStatus === "resolved" && !exact(m, row, ["assignment", "field-write"]).length,
    { file: row.file, methodId: m?.id, location: row.location, source: row.source, effect });
  const loop = rows.filter(r => r.file === row.file && r.kind === "for" && contains(r.location, row.location)).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (loop && /for\s*\([^;]*;[^;]*;/.test(loop.source.slice(0, row.start - loop.start))) {
    const graph = m.executionModel.flowGraph, update = graph.nodes.find(n => n.kind === "for:update" && rangeKey(n.lineRange) === rangeKey(loop.location));
    add("for update effect is reached from the update control point", Boolean(update) && reachable(m.executionModel, update.id, step.flowNodeId),
      { file: row.file, methodId: m.id, location: row.location, updateNodeId: update?.id, effectNodeId: step?.flowNodeId });
  }
}

const guarded = rows.filter(r => r.kind === "call" && r.methodStart >= 0 && r.guards);
add("68 historical short-circuit RHS calls", guarded.length === 68, { actual: guarded.length });
for (const row of guarded) {
  const m = methodFor(row), matches = exact(m, row, ["call"]), step = matches[0];
  const expected = [...row.guards.matchAll(/(CONDITIONAL_AND|CONDITIONAL_OR)@(\d+):([\s\S]*?)(?= \| CONDITIONAL_(?:AND|OR)@\d+:|$)/g)]
    .map(match => ({ expression: match[3], when: match[1] === "CONDITIONAL_AND" }));
  add("each RHS call has its source-derived evaluation guards and incoming CFG route", matches.length === 1 && expected.length > 0 && expected.every(g => step.guards.some(actual =>
    expressionKey(actual.expression) === expressionKey(g.expression) && actual.when === g.when)) && m.executionModel.flowGraph.edges.some(e => e.to === step.flowNodeId),
    { file: row.file, methodId: m?.id, location: row.location, source: row.source, expected, actual: step?.guards });
}
const startsWith = guarded.find(r => r.file.endsWith("/QueryEngine.java") && r.source.startsWith("id.startsWith"));
if (startsWith) {
  const m = methodFor(startsWith), step = exact(m, startsWith, ["call"])[0], snapshot = m.executionModel.states.find(s => s.nodeId === step.flowNodeId);
  const id = m.executionModel.symbols.find(s => s.name === "id" && s.kind === "parameter")?.id;
  add("QueryEngine id null path excludes startsWith", Boolean(id) && snapshot.before[id]?.nullability === "non-null" && step.guards.some(g => compact(g.expression) === "id==null" && g.when === false),
    { file: m.file, methodId: m.id, state: snapshot.before[id], guards: step.guards });
} else add("QueryEngine null guard example present", false);

const continues = rows.filter(r => r.kind === "continue" && r.methodStart >= 0);
add("one source continue", continues.length === 1 && allSteps.filter(s => s.kind === "continue").length === 1, { source: continues.length, v2: allSteps.filter(s => s.kind === "continue").length });
for (const row of continues) {
  const m = methodFor(row), matches = exact(m, row, ["continue"]), step = matches[0];
  const owner = rows.filter(r => r.file === row.file && ["while", "for", "for-each", "do"].includes(r.kind) && contains(r.location, row.location)).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  const transition = step?.transition, target = m.executionModel.flowGraph.nodes.find(n => n.id === transition?.targetNodeId);
  const expectedTargetKind = { while: "while:condition", for: "for:update", "for-each": "for-each:advance", do: "do:condition" }[owner?.kind];
  add("continue exact location and nearest owning loop destination", matches.length === 1 && transition?.kind === "continue" && target?.kind === expectedTargetKind && rangeKey(transition.targetRange) === rangeKey(owner?.location),
    { file: row.file, methodId: m.id, location: row.location, source: row.source, owner: owner?.location, transition, target });
  const following = m.executionModel.orderedSteps.filter(s => s.kind === "call" && s.lineRange.startLine > row.location.endLine && s.lineRange.endLine <= owner.location.endLine);
  add("continue skips remaining iteration before next loop condition", following.length > 0 && following.every(s => !reachable(m.executionModel, step.flowNodeId, s.flowNodeId, transition.targetNodeId)),
    { file: row.file, methodId: m.id, continueNodeId: step.flowNodeId, skippedCalls: following.map(s => ({ snippet: s.snippet, lineRange: s.lineRange })) });
}

const report = { generatedAt: new Date().toISOString(), sourceRoot, outRoot, baselineRoot,
  methodology: "Fresh independent JDK compiler source inventory plus original source hashes and inclusive ranges; every historical operation role/range is matched separately in legacy and v2. Fresh model graph, guards, state lattice, declarations, effects and continue paths are inspected. Fixture tests establish broader grammar behavior; this sample acceptance does not claim runtime/interprocedural/heap or NPE-warning verification.",
  passed: checks.every(c => c.passed), summary: { files: files.length, methods: methods.length, historicalOperations: historicalComparisons.length, declarations: declarations.length,
    uninitialized: uninitialized.length, mutations: mutations.length, continues: continues.length, guardedCalls: guarded.length,
    checks: checks.length, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length }, failures: checks.filter(c => !c.passed), checks };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, passed: report.passed, report: reportPath }, null, 2));if (!report.passed) process.exitCode = 1;

function argumentsMap(values) { const result = {}; for (let i = 0; i < values.length; i += 2) { if (!values[i].startsWith("--") || !values[i + 1]) throw new Error("Arguments must be --name value pairs"); result[values[i].slice(2)] = values[i + 1]; } return result; }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function metadata(root) {
  const manifest = path.join(root, "index/java-files.json");
  if (fs.existsSync(manifest)) return json(manifest).map(f => json(path.join(root, "index", f.metadataPath)));
  return fs.readFileSync(path.join(root, "index/java-summary.jsonl"), "utf8").trim().split(/\r?\n/).map(line => { const f = JSON.parse(line); return { ...f, methods: f.types.flatMap(t => t.methods) }; });
}
function source(file) { const candidate = path.resolve(sourceRoot, file); if (!candidate.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Source escapes root: ${file}`); if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(candidate, "utf8")); return sourceCache.get(file); }
function span(file, r) { if (!r) return ""; const lines = source(file).split(/\r?\n/), [a, b, c, d] = rangeParts(r); if (a === c) return (lines[a - 1] ?? "").slice(b - 1, d); return [(lines[a - 1] ?? "").slice(b - 1), ...lines.slice(a, c - 1), (lines[c - 1] ?? "").slice(0, d)].join("\n"); }
function rangeParts(r = {}) { return [r.startLine ?? r.line, r.startColumn ?? r.column, r.endLine, r.endColumn]; }
function rangeKey(r) { return rangeParts(r).join(":"); }
function contains(outer, inner) { if (!outer || !inner) return false; const [a, b, c, d] = rangeParts(outer), [e, f, g, h] = rangeParts(inner); return a * 1e6 + b <= e * 1e6 + f && c * 1e6 + d >= g * 1e6 + h; }
function compact(text = "") { return text.replace(/\s+/g, ""); }
function expressionKey(text) { let result = compact(text); while (result.startsWith("(") && result.endsWith(")")) { let depth = 0, enclosed = true; for (let i = 0; i < result.length - 1; i++) { if (result[i] === "(") depth++; if (result[i] === ")") depth--; if (!depth) { enclosed = false; break; } } if (!enclosed) break; result = result.slice(1, -1); } return result; }
function legacyIdentity(s) { return [s.kind, rangeKey(s.lineRange), s.snippet, s.branchPath, s.call?.methodName, s.call?.resolvedMethodId, s.field?.id]; }
function reachable(model, from, to, blocked) {
  const edges = new Map();for (const e of model.flowGraph.edges) { if (!edges.has(e.from)) edges.set(e.from, []); edges.get(e.from).push(e); }
  const queue = [{ node: from, tokens: {} }], seen = new Set();
  while (queue.length) { const current = queue.shift(), key = `${current.node}|${JSON.stringify(current.tokens)}`; if (seen.has(key) || current.node === blocked) continue; seen.add(key); if (current.node === to) return true;
    for (const e of edges.get(current.node) ?? []) { if (e.kind === "exception:possible" || e.pendingKind === "exception:possible") continue; if (e.requiresCompletion && current.tokens[e.requiresCompletion.frameId] !== e.requiresCompletion.token) continue;
      const tokens = { ...current.tokens };for (const action of e.completionActions ?? []) { if (action.action === "clear") delete tokens[action.frameId]; else tokens[action.frameId] = action.token; }
      queue.push({ node: e.to, tokens: Object.fromEntries(Object.entries(tokens).sort()) });
    }
  }
  return false;
}
