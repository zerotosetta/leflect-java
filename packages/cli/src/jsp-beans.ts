import fs from "fs/promises";
import path from "path";

import AdmZip from "adm-zip";
import type { JspCustomTagElementNode, JspDocumentNode, JspDocumentRoot } from "@leflect-java/parser-jsp";
import type { JspBeanAction } from "@leflect-java/schema";

type Options = {
  root: string;
  javaVersion?: string;
  jdkSourceArchive?: string;
};

type SourceArchive = { path: string; zip: AdmZip; version: string };

const USE_BEAN_DESCRIPTION = "Finds a Java object in the specified JSP scope and binds it to the id. If absent, it can create an instance of the specified class.";

export async function describeJspBeans(
  docs: readonly { path: string; document?: JspDocumentRoot }[],
  options: Options
): Promise<Map<string, JspBeanAction[]>> {
  const results = new Map<string, JspBeanAction[]>();
  const beanNodes = docs.flatMap((doc) => doc.document
    ? collectUseBeans(doc.document).map((node) => ({ file: doc.path, node }))
    : []);
  if (beanNodes.length === 0) {
    return results;
  }
  const version = options.javaVersion === undefined
    ? await detectMavenJavaVersion(options.root)
    : javaMajorVersion(options.javaVersion);
  const archive = options.jdkSourceArchive && version
    ? await openMatchingSourceArchive(path.resolve(options.root, options.jdkSourceArchive), version)
    : undefined;
  const apiByType = new Map<string, JspBeanAction["api"]>();
  for (const { file, node } of beanNodes) {
    const className = (node.attributes["class"] ?? node.attributes["type"])?.trim() || undefined;
    if (archive && className && !apiByType.has(className)) {
      apiByType.set(className, findTypeDocumentation(archive, className));
    }
    const api = className ? apiByType.get(className) : undefined;
    const action: JspBeanAction = {
      id: node.attributes["id"],
      className,
      scope: node.attributes["scope"] ?? "page",
      lineRange: node.lineRange,
      actionDescription: USE_BEAN_DESCRIPTION,
      api,
      apiDescriptionStatus: api ? "available" : archive ? "type-unavailable" : "source-unavailable"
    };
    const existing = results.get(file);
    if (existing) {
      existing.push(action);
    } else {
      results.set(file, [action]);
    }
  }
  return results;
}

function collectUseBeans(node: JspDocumentNode): JspCustomTagElementNode[] {
  if (node.kind === "Document" || node.kind === "HtmlElement") {
    return node.children.flatMap(collectUseBeans);
  }
  if (node.kind !== "CustomTagElement") {
    return [];
  }
  const nested = node.children.flatMap(collectUseBeans);
  return node.prefix === "jsp" && node.name === "useBean" ? [node, ...nested] : nested;
}

async function detectMavenJavaVersion(root: string): Promise<string | undefined> {
  const pom = await fs.readFile(path.join(root, "pom.xml"), "utf8").catch(() => undefined);
  const properties = pom?.replace(/<!--[\s\S]*?-->/g, "").match(/<properties>([\s\S]*?)<\/properties>/)?.[1];
  if (!properties) {
    return undefined;
  }
  const values = new Map([...properties.matchAll(/<([\w.-]+)>\s*([^<>]+?)\s*<\/\1>/g)]
    .map((match) => [match[1], match[2]]));
  for (const name of ["maven.compiler.release", "maven.compiler.target", "maven.compiler.source", "java.version"]) {
    const raw = values.get(name);
    if (raw) {
      const reference = raw.match(/^\$\{([\w.-]+)\}$/)?.[1];
      return javaMajorVersion(reference ? values.get(reference) : raw);
    }
  }
  return undefined;
}

function javaMajorVersion(version?: string): string | undefined {
  return version?.trim().match(/^(?:1\.)?(\d+)(?:[._+-][\w.+-]+)?$/)?.[1];
}

async function openMatchingSourceArchive(archivePath: string, version: string): Promise<SourceArchive | undefined> {
  const archiveDir = path.dirname(archivePath);
  const jdkHome = path.basename(archiveDir) === "lib" ? path.dirname(archiveDir) : archiveDir;
  const release = await fs.readFile(path.join(jdkHome, "release"), "utf8").catch(() => undefined);
  const installedVersion = javaMajorVersion(release?.match(/^JAVA_VERSION="([^"]+)"/m)?.[1]);
  if (installedVersion && installedVersion !== version) {
    return undefined;
  }
  try {
    const zip = new AdmZip(await fs.readFile(archivePath));
    if (Number(version) < 9 && zip.getEntries().some((entry) =>
      /(?:^|\/)java\.base\/module-info\.java$/.test(entry.entryName)
    )) {
      return undefined;
    }
    return { path: archivePath, zip, version };
  } catch {
    return undefined;
  }
}

function findTypeDocumentation(archive: SourceArchive, className: string): JspBeanAction["api"] {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(className)) {
    return undefined;
  }
  const parts = className.replace(/\$/g, ".").split(".");
  const simpleName = parts[parts.length - 1];
  for (let length = parts.length; length > 1; length -= 1) {
    const relativePath = `${parts.slice(0, length).join("/")}.java`;
    const entry = archive.zip.getEntry(relativePath) ?? archive.zip.getEntries().find((item) =>
      item.entryName.endsWith(`/${relativePath}`)
    );
    if (!entry) {
      continue;
    }
    try {
      const source = entry.getData().toString("utf8");
      const description = extractTypeDescription(source, simpleName);
      return description ? {
        javaVersion: archive.version,
        description,
        source: `${archive.path}!/${entry.entryName}`
      } : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractTypeDescription(source: string, simpleName: string): string | undefined {
  for (const comment of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const declaration = source.slice(comment.index + comment[0].length).match(
      /^\s*(?:(?:public|protected|private|static|abstract|final|sealed|non-sealed|strictfp)\s+|@[\w.]+(?:\([^\r\n]*\))?\s*)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)\b/
    );
    if (declaration?.[1] !== simpleName) {
      continue;
    }
    const paragraph = comment[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .join("\n")
      .trim()
      .split(/<p(?:\s[^>]*)?>|\r?\n\s*(?:\r?\n|@)/i)[0];
    return paragraph
      .replace(/\{@(?:code|literal)\s+([^}]+)\}/g, "$1")
      .replace(/\{@link(?:plain)?\s+(\S+)(?:\s+([^}]+))?\}/g, (_match, link: string, label?: string) => label ?? link)
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim() || undefined;
  }
  return undefined;
}
