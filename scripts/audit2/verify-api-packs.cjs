const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const workspace = path.resolve(__dirname, "../..");
const main = path.resolve(process.argv[2] || path.join(workspace, "analysis/legacy-bank-java8/audit2-20261105-1853"));
const fallback = path.resolve(process.argv[3] || path.join(workspace, "analysis/legacy-bank-java8/audit2-20261105-1845-fallback"));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonl = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hashValue = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const list = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? list(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const AdmZip = createRequire(path.join(workspace, "packages/cli/package.json"))("adm-zip");
const { withAnalysisClasspath, createExternalSymbolResolver } = require(path.join(workspace, "packages/cli/dist/external-symbols.js"));
const verification = path.join(fallback, "verification");
fs.mkdirSync(verification, { recursive: true });
const differences = [];
const checks = [];
function check(name, passed, details) {
  checks.push({ name, passed, ...details });
  if (!passed) differences.push(name);
}
function compare(name, a, b) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(name, same, { mainCount: a.length, fallbackCount: b.length, mainSha256: hashValue(a), fallbackSha256: hashValue(b) });
}
function snapshot(directory) {
  const javaFiles = read(path.join(directory, "index/java-files.json"));
  const jspFiles = read(path.join(directory, "index/jsp-files.json"));
  const java = javaFiles.map(file => read(path.join(directory, "index", file.metadataPath)));
  const jsp = jspFiles.map(file => read(path.join(directory, "index", file.metadataPath)));
  const calls = java.flatMap(file => file.calls).map(call => ({
    file: call.fromFile, location: call.location, fromMethodId: call.fromMethodId,
    target: call.resolvedMethodId, resolvedClassId: call.resolvedClassId,
    declaredReturnType: call.declaredReturnType, expressionType: call.expressionType,
    expressionTypeStatus: call.expressionTypeStatus, responseType: call.responseType
  }));
  const refs = java.flatMap(file => file.classReferences.map(reference => ({ file: file.path, ...reference })));
  const functions = jsp.flatMap(file => (file.functionCalls ?? []).map(reference => ({ file: file.path, ...reference })));
  const tags = jsp.flatMap(file => (file.tags ?? []).map(reference => ({ file: file.path, ...reference })));
  return { java, jsp, calls, refs, functions, tags, counts: read(path.join(directory, "report/summary.json")).counts,
    graphs: Object.fromEntries(["java-call", "java-type-reference", "java-new", "jsp-java", "file-dependency"]
      .map(name => [name, jsonl(path.join(directory, "graph", name + ".jsonl"))])) };
}

(async () => {
  const run = read(path.join(fallback, "analysis-run.json"));
  check("fallback-analysis-exit", run.exitCode === 0, { run });
  const environments = {};
  for (const [name, directory, selection] of [["main", main, "project"], ["fallback", fallback, "pack"]]) {
    environments[name] = {};
    for (const stage of ["java", "jsp"]) {
      const environment = read(path.join(directory, "manifests", `api-packs-${stage}.json`));
      environments[name][stage] = environment;
      check(`${name}-${stage}-selection`, environment.decisions.length === 2 && environment.decisions.every(d => d.selection === selection),
        { decisions: environment.decisions });
      check(`${name}-${stage}-diagnostics`, environment.diagnostics.length === 0, { diagnostics: environment.diagnostics });
    }
  }
  const a = snapshot(main), b = snapshot(fallback);
  check("summary-counts-match", JSON.stringify(a.counts) === JSON.stringify(b.counts), { main: a.counts, fallback: b.counts });
  check("expected-source-and-call-counts", b.java.length === 42 && b.jsp.length === 27 && b.calls.length === 646 &&
    b.refs.length === 966 && b.refs.filter(reference => reference.kind === "new").length === 121 && b.counts.unresolvedEdges === 0,
    { javaFiles: b.java.length, jspFiles: b.jsp.length, calls: b.calls.length, references: b.refs.length, newSites: b.refs.filter(reference => reference.kind === "new").length,
      note: "Raw new-expression sites are counted independently of graph edge aggregation." });
  compare("java-call-target-and-type-records", a.calls, b.calls);
  compare("java-type-reference-records", a.refs, b.refs);
  compare("jsp-function-targets", a.functions, b.functions);
  compare("jsp-tag-targets", a.tags, b.tags);
  for (const name of Object.keys(a.graphs)) compare(`graph-${name}`, a.graphs[name], b.graphs[name]);
  check("jsp-expected-functions-and-custom-targets", b.functions.length === 44 && b.tags.filter(t => t.handlerClass?.startsWith("demo.bank.")).length === 59 &&
    b.tags.filter(t => t.tagFile).length === 42, { functions: b.functions.length, handlerTags: b.tags.filter(t => t.handlerClass?.startsWith("demo.bank.")).length,
      tagFileTags: b.tags.filter(t => t.tagFile).length });

  const configFile = run.command[run.command.indexOf("--config") + 1];
  const config = read(configFile);
  config.analysisOut = fallback;
  const resolve = createExternalSymbolResolver(await withAnalysisClasspath(config));
  const symbols = [...new Set(b.java.flatMap(file => [
    ...file.calls.map(call => call.resolvedMethodId),
    ...file.classReferences.filter(reference => reference.kind !== "import-wildcard" && reference.kind !== "import-static-wildcard")
      .map(reference => reference.resolvedClassId || reference.qualifiedName)
  ]).filter(symbol => typeof symbol === "string" && /^javax\.servlet\./.test(symbol) && !/^javax\.servlet\.jsp\.jstl\./.test(symbol)))].sort();
  const sources = await Promise.all(symbols.map(resolve));
  check("exact-provider-and-source-pairing", sources.length > 0 && sources.every(info => {
    const jsp = info.symbol.startsWith("javax.servlet.jsp.");
    return info.provider.name === (jsp ? "javax.servlet.jsp-api" : "javax.servlet-api") &&
      info.provider.version === (jsp ? "2.3.3" : "4.0.1") && info.source.status === "available" && info.source.version === info.provider.version;
  }), { symbols: sources });

  const pack = path.join(workspace, "resources/api-packs");
  const manifest = read(path.join(pack, "manifest.json"));
  const assets = manifest.components.flatMap(component => ["binary", "sources", "pom"].map(kind => ({
    coordinate: `${component.groupId}:${component.artifactId}:${component.version}`, kind,
    path: component[kind].path, expectedSha256: component[kind].sha256, sha256: hash(path.join(pack, component[kind].path))
  })));
  const licenses = Object.entries(manifest.licenseSha256).map(([file, expectedSha256]) => ({ path: file, expectedSha256, sha256: hash(path.join(pack, file)) }));
  check("six-original-artifact-checksums", assets.length === 6 && assets.every(asset => asset.sha256 === asset.expectedSha256), { assets });
  check("license-notice-checksums", licenses.length === 2 && licenses.every(asset => asset.sha256 === asset.expectedSha256), { licenses });
  const servletLicense = new AdmZip(path.join(pack, manifest.components[0].binary.path)).readFile("META-INF/LICENSE.txt");
  check("servlet-original-license-preserved", servletLicense && servletLicense.equals(fs.readFileSync(path.join(pack, "LICENSE-CDDL-GPL-CLASSPATH.txt"))),
    { license: "META-INF/LICENSE.txt", note: "JSP original POM and source headers are preserved; NOTICE.md records the missing standalone JSP license entry." });
  const deploymentStages = [];
  const originalFiles = list(pack);
  for (const stage of ["scoped-cli", "npx-cli", "binary-work"]) {
    const destination = path.join(verification, "package-assets", stage, "api-packs");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(pack, destination, { recursive: true });
    const records = originalFiles.map(file => ({ path: path.relative(pack, file), sourceSha256: hash(file), stagedSha256: hash(path.join(destination, path.relative(pack, file))) }));
    deploymentStages.push({ stage, destination, files: records, passed: records.every(row => row.sourceSha256 === row.stagedSha256) });
  }
  const cliPackage = read(path.join(workspace, "packages/cli/package.json"));
  const packagingScripts = ["release.mjs", "build-npx-cli.mjs", "build-binary-package.mjs"].map(file => ({
    path: `scripts/${file}`, sha256: hash(path.join(workspace, "scripts", file)), includesApiPackAssets: fs.readFileSync(path.join(workspace, "scripts", file), "utf8").includes('"api-packs"')
  }));
  const binaryScript = fs.readFileSync(path.join(workspace, "scripts/build-binary-package.mjs"), "utf8");
  check("package-asset-staging", deploymentStages.every(stage => stage.passed) && cliPackage.files.includes("api-packs") && packagingScripts.every(script => script.includesApiPackAssets),
    { deploymentStages, packagingScripts, binarySnapshotAssetPatternPresent: binaryScript.includes('"api-packs/**/*"'),
      verificationScope: "Exact asset copies and configured packaging inclusion only; no npm publish/tag, npm pack, or platform executable build was run here." });
  const baseline = read(path.join(workspace, "analysis/work-preparation/baseline.json"));
  const sourceFiles = baseline.sourceFiles.map(file => ({ path: file.path, expectedSha256: file.sha256, sha256: hash(path.join(baseline.sourceRoot, file.path)) }));
  check("original-84-inputs-unchanged", sourceFiles.length === 84 && sourceFiles.every(file => file.expectedSha256 === file.sha256), { sourceFiles });
  const record = { generatedAt: new Date().toISOString(), main, fallback, version: cliPackage.version, environments,
    checks, differences, passed: differences.length === 0, deferred: ["CMS target linking", "SQL/query target linking", "reflection target linking"],
    limits: ["Source/Javadoc availability is separate from binary type resolution.", "This verifies analysis and asset staging, not Java EE container runtime or publication authorization."] };
  const output = path.join(verification, "api-pack-acceptance.json");
  fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ passed: record.passed, checks: checks.length, differences, output, externalApiSymbols: sources.length }));
  if (!record.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
