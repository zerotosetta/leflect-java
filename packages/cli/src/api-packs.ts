import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { LeflectConfig } from "@leflect-java/schema";

type Asset = { path: string; sha256: string; url?: string };
type Component = {
  groupId: string; artifactId: string; version: string; namespace: string;
  representativeClass: string; provider: { name: string; version: string };
  excludedNamespaces?: string[];
  binary: Asset; sources: Asset; pom: Asset; licenseFiles: string[];
};
type Catalog = { schemaVersion: 1; id: string; components: Component[]; licenseSha256: Record<string, string> };
type Dependency = { groupId: string; artifactId: string; version: string; scope: string };
type Diagnostic = { code: string; coordinate?: string; message: string };
type Decision = {
  coordinate: string; selection: "project" | "pack" | "unavailable" | "disabled";
  reason: string; binary?: string; binarySha256?: string; sources?: string;
  sourceSha256?: string; provider?: { name: string; version?: string; path?: string };
};
export type ApiPackEnvironment = {
  schemaVersion: 1; stage: "java" | "jsp"; mode: "off" | "fallback";
  packId?: string; directory: string; decisions: Decision[];
  diagnostics: Diagnostic[]; classpathEntries: string[];
};

/** Local, explicit-coordinate fallback. No artifact download or version guessing. */
export async function resolveApiPackClasspath(
  config: LeflectConfig, existingEntries: string[], stage: "java" | "jsp"
): Promise<string[]> {
  const mode = config.java?.apiPacks?.mode ?? "off";
  const directory = await resolveDirectory(config);
  const environment: ApiPackEnvironment = {
    schemaVersion: 1, stage, mode, directory, decisions: [], diagnostics: [],
    classpathEntries: [...existingEntries]
  };
  if (mode === "fallback") {
    const catalog = await loadCatalog(directory, environment.diagnostics);
    if (catalog) {
      environment.packId = catalog.id;
      const dependencies = await readProjectDependencies(config.root, environment.diagnostics);
      if (!dependencies.length) environment.diagnostics.push({ code: "project-coordinate-unavailable",
        message: "No non-test dependency coordinates could be established from the project POM/local parent; no fallback API version is inferred." });
      for (const dependency of dependencies) {
        const coordinate = coordinateOf(dependency);
        if (/\$\{/.test(dependency.groupId + dependency.artifactId)) {
          environment.diagnostics.push({ code: "coordinate-unresolved", coordinate,
            message: "The declared Maven coordinate contains unresolved properties; fallback selection requires a concrete group and artifact." });
        }
        const matches = catalog.components.filter(c => c.groupId === dependency.groupId && c.artifactId === dependency.artifactId);
        if (!matches.length) {
          if (/^(?:javax|jakarta)\.(?:servlet|el)(?:\.|$)/.test(dependency.groupId)) {
            environment.diagnostics.push({ code: "unsupported-coordinate", coordinate,
              message: "This coordinate/namespace is not supplied by the API pack; the declared project dependency remains authoritative." });
          }
          continue;
        }
        const decision: Decision = { coordinate, selection: "unavailable", reason: "no-exact-version" };
        environment.decisions.push(decision);
        const component = matches.find(c => c.version === dependency.version);
        const project = await findProjectProvider(config.root, existingEntries, matches[0], catalog.components);
        if (project) {
          Object.assign(decision, { selection: "project", reason: "project-dependency-first", binary: project.path, provider: project });
          if (component && project.version && project.version !== component.provider.version) {
            environment.diagnostics.push({ code: "project-version-conflict", coordinate,
              message: `Project provider ${project.name}@${project.version} takes precedence over pack ${component.provider.name}@${component.provider.version}.` });
          }
          // A byte-identical project artifact may reuse its original sources
          // without injecting a second binary or equating spec/artifact versions.
          if (component && project.name === component.provider.name && project.version === component.provider.version &&
              await hashFile(project.path) === component.binary.sha256) {
            decision.binarySha256 = component.binary.sha256;
            await attachMatchingSources(directory, component, decision, environment.diagnostics);
          }
          continue;
        }
        if (!component || !isExactVersion(dependency.version)) {
          environment.diagnostics.push({ code: isExactVersion(dependency.version) ? "unsupported-version" : "version-not-exact", coordinate,
            message: "Fallback requires an exact declared coordinate matching a bundled component; unresolved properties, ranges and unspecified versions are not inferred." });
          continue;
        }
        const binary = await verifyAsset(directory, component.binary);
        const pom = await verifyAsset(directory, component.pom);
        const notices = await Promise.all(component.licenseFiles.map(file => verifyAsset(directory,
          { path: file, sha256: catalog.licenseSha256[file] })));
        if (!binary || !pom || notices.some(value => !value)) {
          decision.reason = "pack-integrity-failed";
          environment.diagnostics.push({ code: "pack-integrity-failed", coordinate,
            message: "The pack binary/POM checksum or required license/notice file could not be verified." });
          continue;
        }
        let zip: AdmZip;
        try { zip = new AdmZip(await fs.readFile(binary)); } catch { continue; }
        if (!zip.getEntry(component.representativeClass.replace(/\./g, "/") + ".class")) {
          decision.reason = "pack-class-missing";
          environment.diagnostics.push({ code: "pack-class-missing", coordinate, message: "The verified archive does not contain its declared representative API class." });
          continue;
        }
        const provider = archiveProvider(zip, binary);
        if (provider.name !== component.provider.name || provider.version !== component.provider.version) {
          decision.reason = "provider-mismatch";
          environment.diagnostics.push({ code: "provider-mismatch", coordinate, message: "The binary's provider identity differs from the pack manifest." });
          continue;
        }
        Object.assign(decision, { selection: "pack", reason: "exact-coordinate-fallback", binary,
          binarySha256: component.binary.sha256, provider });
        environment.classpathEntries.push(binary);
        await attachMatchingSources(directory, component, decision, environment.diagnostics);
      }
    }
  }
  environment.classpathEntries = [...new Set(environment.classpathEntries)];
  const output = path.join(config.analysisOut, "manifests", `api-packs-${stage}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(environment, null, 2) + "\n");
  return environment.classpathEntries;
}

/** Binary/source hashes participate in parse cache invalidation independently. */
export async function createApiPackCacheInput(config: LeflectConfig): Promise<Record<string, unknown>> {
  const mode = config.java?.apiPacks?.mode ?? "off";
  const directory = await resolveDirectory(config);
  if (mode === "off") return { mode };
  const diagnostics: Diagnostic[] = [];
  const catalog = await loadCatalog(directory, diagnostics);
  const dependencies = await readProjectDependencies(config.root, diagnostics);
  const allAssets = catalog ? [...catalog.components.flatMap(c => [c.binary, c.sources, c.pom]),
    ...Object.entries(catalog.licenseSha256).map(([assetPath, sha256]) => ({ path: assetPath, sha256 }))] : [];
  const assets = await Promise.all(allAssets
    .map(async asset => ({ path: asset.path, expectedSha256: asset.sha256,
      sha256: await safeAssetPath(directory, asset.path).then(hashFile).catch(() => null) })));
  return { mode, directory, manifestSha256: await hashFile(path.join(directory, "manifest.json")),
    packId: catalog?.id ?? null, dependencies, assets, diagnostics };
}

export async function readSelectedApiPackSources(config: LeflectConfig, classpath: string[]): Promise<
  NonNullable<NonNullable<LeflectConfig["java"]>["librarySources"]>
> {
  if ((config.java?.apiPacks?.mode ?? "off") !== "fallback") return [];
  const allowed = new Set(classpath.map(p => path.resolve(config.root, p)));
  const sources: NonNullable<NonNullable<LeflectConfig["java"]>["librarySources"]> = [];
  for (const stage of ["java", "jsp"]) {
    try {
      const environment = JSON.parse(await fs.readFile(path.join(config.analysisOut, "manifests", `api-packs-${stage}.json`), "utf8")) as ApiPackEnvironment;
      for (const decision of environment.decisions) {
        if (!(decision.selection === "pack" || decision.selection === "project") || !decision.binary || !allowed.has(decision.binary) ||
            !decision.sources || !decision.provider || !decision.binarySha256 || !decision.sourceSha256) continue;
        if (await hashFile(decision.binary) !== decision.binarySha256 || await hashFile(decision.sources) !== decision.sourceSha256) continue;
        if (!sources.some(s => s.archive === decision.sources)) sources.push({
          provider: decision.provider.name, version: decision.provider.version, archive: decision.sources
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return sources;
}

async function resolveDirectory(config: LeflectConfig): Promise<string> {
  if (config.java?.apiPacks?.directory) return path.resolve(config.root, config.java.apiPacks.directory);
  const candidates = [path.join(__dirname, "api-packs"), path.resolve(__dirname, "../api-packs"),
    path.resolve(__dirname, "../../../resources/api-packs")];
  for (const candidate of candidates) {
    if (await hashFile(path.join(candidate, "manifest.json"))) return materializeSnapshot(candidate);
  }
  return candidates[0];
}

async function materializeSnapshot(directory: string): Promise<string> {
  if (!(process as NodeJS.Process & { pkg?: unknown }).pkg || !/(^|[\\/])snapshot([\\/]|$)/i.test(directory)) return directory;
  const manifest = await fs.readFile(path.join(directory, "manifest.json"));
  const target = path.join(os.tmpdir(), "leflect-java", "api-packs", createHash("sha256").update(manifest).digest("hex"));
  const catalog = JSON.parse(manifest.toString("utf8")) as Catalog;
  const files = [...new Set(catalog.components.flatMap(c => [c.binary.path, c.sources.path, c.pom.path, ...c.licenseFiles]))];
  for (const file of files) {
    const from = await safeAssetPath(directory, file), to = await safeAssetPath(target, file);
    await fs.mkdir(path.dirname(to), { recursive: true });
    const content = await fs.readFile(from).catch(() => undefined);
    if (content) await fs.writeFile(to, content);
  }
  await fs.writeFile(path.join(target, "manifest.json"), manifest);
  return target;
}

async function matchingSourceCoordinate(archive: string, component: Component): Promise<boolean> {
  try {
    const zip = new AdmZip(await fs.readFile(archive));
    const source = component.representativeClass.replace(/\./g, "/") + ".java";
    if (!zip.getEntry(source)) return false;
    const pom = zip.getEntry("pom.xml") ?? zip.getEntry(`META-INF/maven/${component.groupId}/${component.artifactId}/pom.xml`);
    if (!pom) return false;
    const project = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(pom.getData().toString("utf8")).project;
    return (project.groupId || project.parent?.groupId) === component.groupId &&
      project.artifactId === component.artifactId && (project.version || project.parent?.version) === component.version;
  } catch { return false; }
}

async function attachMatchingSources(directory: string, component: Component, decision: Decision, diagnostics: Diagnostic[]): Promise<void> {
  const sources = await verifyAsset(directory, component.sources);
  if (sources && await matchingSourceCoordinate(sources, component)) {
    Object.assign(decision, { sources, sourceSha256: component.sources.sha256 });
  } else {
    diagnostics.push({ code: sources ? "source-version-mismatch" : "source-unavailable", coordinate: decision.coordinate,
      message: "Binary type resolution is available, but the source archive is missing, fails checksum verification, or has a different embedded Maven coordinate." });
  }
}

async function loadCatalog(directory: string, diagnostics: Diagnostic[]): Promise<Catalog | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as Catalog;
    if (value.schemaVersion !== 1 || typeof value.id !== "string" || !Array.isArray(value.components) || !value.licenseSha256 ||
        value.components.some(c => !c.groupId || !c.artifactId || !c.version || !c.namespace || !c.representativeClass ||
          !c.provider?.name || !c.provider?.version || !c.binary?.path || !c.sources?.path || !c.pom?.path ||
          !Array.isArray(c.licenseFiles) || !c.licenseFiles.length)) throw new Error("Unsupported or incomplete API pack manifest");
    return value;
  } catch (error) {
    diagnostics.push({ code: "pack-unavailable", message: `API pack manifest unavailable: ${(error as Error).message}` });
    return undefined;
  }
}

async function safeAssetPath(directory: string, relative: string): Promise<string> {
  const absolute = path.resolve(directory, relative);
  const within = path.relative(path.resolve(directory), absolute);
  if (!within || within === ".." || within.startsWith(".." + path.sep) || path.isAbsolute(within)) throw new Error("Invalid pack asset path");
  return absolute;
}

async function verifyAsset(directory: string, asset: Asset): Promise<string | undefined> {
  try {
    const absolute = await safeAssetPath(directory, asset.path);
    return /^[a-f0-9]{64}$/.test(asset.sha256) && await hashFile(absolute) === asset.sha256 ? absolute : undefined;
  } catch { return undefined; }
}

async function hashFile(file: string): Promise<string | null> {
  try { return createHash("sha256").update(await fs.readFile(file)).digest("hex"); } catch { return null; }
}

function archiveProvider(zip: AdmZip, file: string): { name: string; version?: string; path: string } {
  const manifest = zip.getEntry("META-INF/MANIFEST.MF")?.getData().toString("utf8") ?? "";
  const values = new Map(manifest.replace(/\r?\n /g, "").split(/\r?\n/).flatMap(line => {
    const i = line.indexOf(": "); return i > 0 ? [[line.slice(0, i), line.slice(i + 2)]] : [];
  }));
  const filename = path.basename(file, ".jar");
  return { name: values.get("Automatic-Module-Name") ?? values.get("Implementation-Title") ??
    values.get("Bundle-SymbolicName")?.split(";")[0] ?? filename.replace(/-\d.*$/, ""),
    version: values.get("Implementation-Version") ?? values.get("Bundle-Version") ?? filename.match(/-(\d[\w.+-]*)$/)?.[1], path: file };
}

async function findProjectProvider(root: string, entries: string[], component: Component, components: Component[]) {
  const prefix = component.namespace.replace(/\./g, "/") + "/";
  const exclusions = components.filter(c => c.namespace.startsWith(component.namespace + "."))
    .map(c => c.namespace.replace(/\./g, "/") + "/")
    .concat((component.excludedNamespaces ?? []).map(namespace => namespace.replace(/\./g, "/") + "/"));
  for (const entry of entries) {
    const absolute = path.resolve(root, entry);
    try {
      if (/\.jar$/i.test(absolute)) {
        const zip = new AdmZip(await fs.readFile(absolute));
        if (zip.getEntries().some(e => e.entryName.startsWith(prefix) && e.entryName.endsWith(".class") && !exclusions.some(ex => e.entryName.startsWith(ex)))) {
          return archiveProvider(zip, absolute);
        }
      } else if ((await fs.stat(path.join(absolute, component.representativeClass.replace(/\./g, "/") + ".class"))).isFile()) {
        return { name: path.basename(absolute), path: absolute };
      }
    } catch { /* A missing/unreadable entry must not hide an available exact pack. */ }
  }
  for (const sourceRoot of ["src/main/java", "src", "."]) {
    const file = path.join(root, sourceRoot, component.representativeClass.replace(/\./g, "/") + ".java");
    if ((await fs.stat(file).catch(() => undefined))?.isFile()) return { name: "project-source", path: file };
  }
  return undefined;
}

function coordinateOf(c: { groupId: string; artifactId: string; version: string }): string {
  return `${c.groupId}:${c.artifactId}:${c.version || "<unspecified>"}`;
}
function isExactVersion(version: string): boolean {
  return /^[\w][\w.+-]*$/.test(version) && !/^(?:LATEST|RELEASE)$/i.test(version);
}
function array(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(v => v && typeof v === "object");
}
function string(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }

async function readProjectDependencies(root: string, diagnostics: Diagnostic[]): Promise<Dependency[]> {
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false });
  const visited = new Set<string>();
  type RawDependency = Dependency & { type: string };
  type Model = { properties: Record<string, string>; managed: RawDependency[]; dependencies: RawDependency[] };
  async function read(file: string): Promise<Model> {
    if (visited.has(file)) return { properties: {}, managed: [], dependencies: [] };
    visited.add(file);
    let project: {
      groupId?: unknown; artifactId?: unknown; version?: unknown;
      properties?: Record<string, unknown>;
      parent?: { groupId?: unknown; version?: unknown; relativePath?: unknown };
      dependencyManagement?: { dependencies?: { dependency?: unknown } };
      dependencies?: { dependency?: unknown };
    };
    try { project = parser.parse(await fs.readFile(file, "utf8")).project; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push({ code: "pom-unreadable", message: `Cannot read declared Maven dependencies: ${(error as Error).message}` });
      return { properties: {}, managed: [], dependencies: [] };
    }
    let parent: Model = { properties: {}, managed: [], dependencies: [] };
    if (project?.parent) {
      const relative = project.parent.relativePath === "" ? "" : string(project.parent.relativePath) || "../pom.xml";
      if (relative) parent = await read(path.resolve(path.dirname(file), relative));
    }
    const properties: Record<string, string> = { ...parent.properties };
    for (const [key, value] of Object.entries(project?.properties ?? {})) properties[key] = string(value);
    const group = string(project?.groupId) || string(project?.parent?.groupId);
    const version = string(project?.version) || string(project?.parent?.version);
    Object.assign(properties, { "project.groupId": group, "pom.groupId": group,
      "project.version": version, "pom.version": version, "project.artifactId": string(project?.artifactId) });
    // Inherited templates must be interpolated in the effective child context.
    // Expanding a parent's ${api.version} here would silently ignore a child override.
    const raw = (value: Record<string, unknown>): RawDependency => ({ groupId: string(value.groupId),
      artifactId: string(value.artifactId), version: string(value.version), scope: string(value.scope), type: string(value.type) });
    const managed = [...parent.managed, ...array(project?.dependencyManagement?.dependencies?.dependency).map(raw)];
    const dependencies = [...parent.dependencies, ...array(project?.dependencies?.dependency).map(raw)];
    return { properties, managed, dependencies };
  }
  const model = await read(path.join(root, "pom.xml"));
  function expand(value: string): string {
    for (let i = 0; i < 10; i++) {
      const next = value.replace(/\$\{([^}]+)\}/g, (match, key: string) => model.properties[key] ?? match);
      if (next === value) break;
      value = next;
    }
    return value;
  }
  function effective(rows: RawDependency[]): Map<string, RawDependency> {
    const result = new Map<string, RawDependency>();
    for (const row of rows) {
      const resolved = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, expand(value)])) as RawDependency;
      const key = `${resolved.groupId}:${resolved.artifactId}`;
      const inherited = result.get(key);
      result.set(key, { ...inherited, ...Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== "")) } as RawDependency);
    }
    return result;
  }
  const managed = effective(model.managed);
  return [...effective(model.dependencies)].map(([key, dependency]) => ({
    ...managed.get(key), ...Object.fromEntries(Object.entries(dependency).filter(([, value]) => value !== "")),
    version: dependency.version || managed.get(key)?.version || "",
    scope: dependency.scope || managed.get(key)?.scope || "compile"
  } as RawDependency)).filter(dependency => dependency.scope !== "test" && dependency.scope !== "import" && dependency.type !== "pom");
}
