import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import type { ExternalSymbolInfo, LeflectConfig } from "@leflect-java/schema";

type Archive = { path: string; zip: AdmZip; version?: string };
type Provider = ExternalSymbolInfo["provider"];
type LibrarySource = NonNullable<NonNullable<LeflectConfig["java"]>["librarySources"]>[number];

/** Reuse the exact dependency environment recorded by the parse stages, including discovery. */
export async function withAnalysisClasspath(config: LeflectConfig): Promise<LeflectConfig> {
  const manifests = await Promise.all(["java-parse.json", "jsp-parse.json"].map(async (name) => {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(config.analysisOut, "manifests", name), "utf8")) as { classpathEntries?: unknown };
      return Array.isArray(manifest.classpathEntries) ? manifest.classpathEntries.filter((value): value is string => typeof value === "string") : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }));
  const classpath = [...new Set([...manifests.flat(), ...(config.java?.classpath ?? []), ...(config.jsp?.classpath ?? [])])];
  return { ...config, java: { ...config.java, classpath }, jsp: { ...config.jsp, classpath } };
}

export function createExternalSymbolResolver(config: LeflectConfig) {
  const archiveCache = new Map<string, Promise<Archive | undefined>>();
  const providerCache = new Map<string, Promise<Provider>>();
  const symbolCache = new Map<string, Promise<ExternalSymbolInfo>>();
  const classpath = [...new Set([...(config.java?.classpath ?? []), ...(config.jsp?.classpath ?? [])])];

  function openArchive(archivePath: string): Promise<Archive | undefined> {
    const absolute = path.resolve(config.root, archivePath);
    let cached = archiveCache.get(absolute);
    if (!cached) {
      cached = fs.readFile(absolute).then(async (content) => {
        const zip = new AdmZip(content);
        const dir = path.dirname(absolute);
        const home = path.basename(dir) === "lib" ? path.dirname(dir) : dir;
        const release = await fs.readFile(path.join(home, "release"), "utf8").catch(() => "");
        return { path: absolute, zip, version: major(release.match(/^JAVA_VERSION="([^"]+)"/m)?.[1]) };
      }).catch(() => undefined);
      archiveCache.set(absolute, cached);
    }
    return cached;
  }

  async function findProvider(className: string): Promise<Provider> {
    for (const configured of classpath) {
      const absolute = path.resolve(config.root, configured);
      if (/\.jar$/i.test(absolute)) {
        const archive = await openArchive(absolute);
        if (!archive || !classEntries(className).some((entry) => archive.zip.getEntry(entry))) continue;
        const manifest = archive.zip.getEntry("META-INF/MANIFEST.MF")?.getData().toString("utf8") ?? "";
        const values = parseManifest(manifest);
        const filename = path.basename(absolute, ".jar");
        return {
          name: values.get("Automatic-Module-Name") ?? values.get("Implementation-Title") ??
            values.get("Bundle-SymbolicName")?.split(";")[0] ?? filename.replace(/-\d.*$/, ""),
          version: values.get("Implementation-Version") ?? values.get("Bundle-Version") ??
            filename.match(/-(\d[\w.+-]*)$/)?.[1],
          path: absolute
        };
      } else {
        for (const entry of classEntries(className)) {
          if ((await fs.stat(path.join(absolute, entry)).catch(() => undefined))?.isFile()) {
            return { name: path.basename(absolute), path: absolute };
          }
        }
      }
    }
    if (/^(?:java\.|javax\.(?:crypto|naming|net|security|sql|swing|management|imageio|print|sound|tools|lang\.model)\.)/.test(className)) {
      const runtimeHome = config.java?.jreHome ?? config.java?.javaHome;
      const release = runtimeHome
        ? await fs.readFile(path.join(runtimeHome, "release"), "utf8").catch(() => "")
        : "";
      return { name: "jdk", version: major(config.java?.targetVersion) ??
        major(release.match(/^JAVA_VERSION="([^"]+)"/m)?.[1]), path: runtimeHome };
    }
    if (className.startsWith("javax.servlet.jsp.")) return { name: "javax.servlet.jsp" };
    if (className.startsWith("javax.servlet.")) return { name: "javax.servlet" };
    if (className.startsWith("jakarta.servlet.jsp.")) return { name: "jakarta.servlet.jsp" };
    if (className.startsWith("jakarta.servlet.")) return { name: "jakarta.servlet" };
    return { name: className.split(".").slice(0, -1).join(".") || className };
  }

  async function resolve(symbol: string): Promise<ExternalSymbolInfo> {
    const className = symbol.split("#")[0];
    let providerPromise = providerCache.get(className);
    if (!providerPromise) {
      providerPromise = findProvider(className);
      providerCache.set(className, providerPromise);
    }
    const provider = await providerPromise;
    const info: ExternalSymbolInfo = { symbol, provider, source: { status: "not-provided" } };
    if (!validClassName(className)) return info;
    const sources: LibrarySource[] = provider.name === "jdk" && config.java?.sourceArchive
      ? [{ provider: "jdk", version: provider.version, archive: config.java.sourceArchive }]
      : (config.java?.librarySources ?? []).filter((source) => source.provider === provider.name);
    if (!sources.length) return info;
    let mismatch = false;
    for (const configured of sources) {
      if (provider.version && configured.version && provider.version !== configured.version) {
        mismatch = true;
        continue;
      }
      const archive = await openArchive(configured.archive);
      if (!archive) continue;
      const version = provider.name === "jdk" ? archive.version ?? configured.version : configured.version;
      const modular = archive.zip.getEntries().some((entry) =>
        /(?:^|\/)java\.base\/module-info\.java$/.test(entry.entryName));
      if (provider.name === "jdk" && provider.version &&
          ((archive.version && archive.version !== provider.version) ||
            (Number(provider.version) < 9 && modular))) {
        mismatch = true;
        continue;
      }
      const entry = findSourceEntry(archive.zip, className);
      if (entry) {
        return { symbol, provider, source: {
          status: "available", archive: archive.path, entry, version
        } };
      }
    }
    return { ...info, source: { status: mismatch ? "version-mismatch" : "not-found" } };
  }

  return (symbol: string): Promise<ExternalSymbolInfo> => {
    let cached = symbolCache.get(symbol);
    if (!cached) {
      cached = resolve(symbol);
      symbolCache.set(symbol, cached);
    }
    return cached;
  };
}

export async function readExternalSymbolSource(info: ExternalSymbolInfo): Promise<{
  path: string; language: "java"; content: string; truncated: boolean;
} | undefined> {
  if (info.source.status !== "available" || !info.source.archive || !info.source.entry) return undefined;
  try {
    const zip = new AdmZip(await fs.readFile(info.source.archive));
    const entry = zip.getEntry(info.source.entry);
    if (!entry || entry.isDirectory) return undefined;
    const content = entry.getData().toString("utf8");
    return {
      path: `${info.source.archive}!/${info.source.entry}`, language: "java",
      content: content.slice(0, 200_000), truncated: content.length > 200_000
    };
  } catch {
    return undefined;
  }
}

function major(value?: string): string | undefined {
  return value?.match(/^(?:1\.)?(\d+)/)?.[1];
}

function parseManifest(content: string): Map<string, string> {
  return new Map(content.replace(/\r?\n /g, "").split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(": ");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 2)]] : [];
  }));
}

function validClassName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(name);
}

function classEntries(name: string): string[] {
  if (!validClassName(name)) return [];
  const parts = name.split(".");
  const entries: string[] = [];
  for (let index = parts.length - 1; index > 0; index--) {
    entries.push(parts.slice(0, index).join("/") + "/" + parts.slice(index).join("$") + ".class");
  }
  return entries;
}

function findSourceEntry(zip: AdmZip, className: string): string | undefined {
  const parts = className.replace(/\$/g, ".").split(".");
  const simpleName = parts.at(-1)!;
  const declaresType = (entry: AdmZip.IZipEntry) => {
    const visible = entry.getData().toString("utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
    return new RegExp("\\b(?:class|interface|enum|record|@interface)\\s+" + simpleName.replace(/\$/g, "\\$") + "\\b").test(visible);
  };
  for (let length = parts.length; length > 1; length--) {
    const suffix = parts.slice(0, length).join("/") + ".java";
    const direct = zip.getEntry(suffix);
    if (direct && !direct.isDirectory && declaresType(direct)) return direct.entryName;
    const matches = zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.endsWith("/" + suffix) && declaresType(entry));
    if (matches.length === 1) return matches[0].entryName;
  }
  return undefined;
}
