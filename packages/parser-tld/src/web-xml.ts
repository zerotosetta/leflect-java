import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { LineRange } from "@leflect-java/schema";

export type WebServletMapping = {
  servletName: string;
  className?: string;
  urlPattern: string;
  lineRange: LineRange;
  declarationRange?: LineRange;
};

export function parseWebXml(source: string): WebServletMapping[] {
  const valid = XMLValidator.validate(source);
  if (valid !== true) {
    throw new Error(`Invalid web.xml at line ${valid.err.line}: ${valid.err.msg}`);
  }
  const xml = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true
  }).parse(source) as Record<string, unknown>;
  const root = xml["web-app"] as Record<string, unknown> | undefined;
  if (!root) return [];
  const declarations = blocks(source, "servlet");
  const mappings = blocks(source, "servlet-mapping");
  const byName = new Map<string, { className: string; range?: LineRange }>();
  for (const value of list(root.servlet)) {
    const servletName = scalar(value["servlet-name"]);
    const className = scalar(value["servlet-class"]);
    if (!servletName || !className) continue;
    const declaration = declarations.find((block) => block.name === servletName);
    byName.set(servletName, { className, range: declaration?.lineRange });
  }
  return list(root["servlet-mapping"]).flatMap((value) => {
    const servletName = scalar(value["servlet-name"]);
    if (!servletName) return [];
    const declared = byName.get(servletName);
    return values(value["url-pattern"]).flatMap((urlPattern) => {
      if (!urlPattern) return [];
      const location = mappings.find((block) => block.name === servletName && block.patterns.includes(urlPattern));
      return [{
        servletName,
        className: declared?.className,
        urlPattern,
        lineRange: location?.lineRange ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        declarationRange: declared?.range
      }];
    });
  });
}

function list(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function values(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map(scalar).filter((item): item is string => item !== undefined);
}

function blocks(source: string, name: string) {
  const masked = source.replace(/<!--[\s\S]*?-->/g, (text) => text.replace(/[^\r\n]/g, " "));
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}\\s*>`, "g");
  return [...masked.matchAll(expression)].map((match) => {
    const content = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(match[0]) as Record<string, Record<string, unknown>>;
    const block = content[name];
    const before = source.slice(0, match.index);
    const end = source.slice(0, match.index! + match[0].length);
    return {
      name: scalar(block?.["servlet-name"]),
      patterns: values(block?.["url-pattern"]),
      lineRange: {
        startLine: before.split("\n").length,
        startColumn: before.length - before.lastIndexOf("\n"),
        endLine: end.split("\n").length,
        endColumn: end.length - end.lastIndexOf("\n") - 1
      }
    };
  });
}
