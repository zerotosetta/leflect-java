import fs from "fs/promises";
import path from "path";

import { JspAstMode } from "@leflect-java/schema";

export type JspDirective = {
  kind: "taglib" | "page" | "include";
  attributes: Record<string, string>;
  raw: string;
  location: SourceLocation;
};

export type TaglibDirective = {
  prefix: string;
  uri: string;
  location: SourceLocation;
};

export type JspTag = {
  prefix: string;
  name: string;
  raw: string;
  location: SourceLocation;
};

export type ScriptletBlock = {
  kind: "scriptlet" | "expression" | "declaration";
  code: string;
  location: SourceLocation;
  codeOffset: number;
};

export type JspAstReference = {
  mode: JspAstMode;
  generatedServletPath?: string;
  astPath?: string;
};

export type JspParseResult = {
  directives: JspDirective[];
  imports: string[];
  includes: string[];
  taglibs: TaglibDirective[];
  tags: JspTag[];
  scriptlets: ScriptletBlock[];
  ast?: JspAstReference;
};

const DIRECTIVE_REGEX = /<%@\s*([a-zA-Z0-9_]+)\s+([^%]*)%>/gi;
const ATTR_REGEX = /(\w+)\s*=\s*"([^"]+)"/g;
const TAG_REGEX = /<([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)(\s|>|\/)/g;
const SCRIPTLET_REGEX = /<%([\s\S]*?)%>/g;

export type SourceLocation = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

export function parseJsp(content: string): JspParseResult {
  const directives = extractDirectives(content);
  return {
    directives,
    imports: extractImports(directives),
    includes: extractIncludes(directives),
    taglibs: extractTaglibs(directives),
    tags: extractTags(content),
    scriptlets: extractScriptlets(content)
  };
}

export async function writeJspMeta(
  outDir: string,
  jspPath: string,
  result: JspParseResult
): Promise<string> {
  const normalized = normalizePath(jspPath);
  const target = path.join(outDir, `${normalized}.json`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify({ path: normalized, ...result }, null, 2)
  );
  return target;
}

export function attachJspAstReference(
  result: JspParseResult,
  ast: JspAstReference
): JspParseResult {
  return {
    ...result,
    ast
  };
}

function extractDirectives(content: string): JspDirective[] {
  const directives: JspDirective[] = [];
  let match: RegExpExecArray | null;

  while ((match = DIRECTIVE_REGEX.exec(content)) !== null) {
    const kind = match[1].toLowerCase();
    const attrs = match[2];
    const attributes = extractAttributes(attrs);

    if (kind === "taglib" || kind === "page" || kind === "include") {
      directives.push({
        kind,
        attributes,
        raw: match[0],
        location: toLocation(content, match.index, match.index + match[0].length)
      });
    }
  }

  return directives;
}

function extractAttributes(value: string): Record<string, string> {
  const record: Record<string, string> = {};
  let attrMatch: RegExpExecArray | null;

  ATTR_REGEX.lastIndex = 0;
  while ((attrMatch = ATTR_REGEX.exec(value)) !== null) {
    record[attrMatch[1]] = attrMatch[2];
  }

  return record;
}

function extractImports(directives: JspDirective[]): string[] {
  const imports = new Set<string>();

  for (const directive of directives) {
    if (directive.kind !== "page") {
      continue;
    }

    const value = directive.attributes["import"];
    if (!value) {
      continue;
    }

    for (const item of value.split(",")) {
      const normalized = item.trim();
      if (normalized) {
        imports.add(normalized);
      }
    }
  }

  return [...imports].sort();
}

function extractIncludes(directives: JspDirective[]): string[] {
  const includes = new Set<string>();

  for (const directive of directives) {
    if (directive.kind !== "include") {
      continue;
    }

    const value = directive.attributes["file"]?.trim();
    if (value) {
      includes.add(value);
    }
  }

  return [...includes].sort();
}

function extractTaglibs(directives: JspDirective[]): TaglibDirective[] {
  return directives
    .filter((directive) => directive.kind === "taglib")
    .map((directive) => ({
      prefix: directive.attributes["prefix"],
      uri: directive.attributes["uri"],
      location: directive.location
    }))
    .filter((directive): directive is TaglibDirective => Boolean(directive.prefix && directive.uri));
}

function extractTags(content: string): JspTag[] {
  const tags: JspTag[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(content)) !== null) {
    tags.push({
      prefix: match[1],
      name: match[2],
      raw: match[0],
      location: toLocation(content, match.index, match.index + match[0].length)
    });
  }

  return tags;
}

function extractScriptlets(content: string): ScriptletBlock[] {
  const blocks: ScriptletBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPTLET_REGEX.exec(content)) !== null) {
    const raw = match[0];
    const body = match[1];

    if (raw.startsWith("<%@")) {
      continue;
    }

    let kind: ScriptletBlock["kind"] = "scriptlet";
    let bodyOffset = match.index + 2;
    if (raw.startsWith("<%=")) {
      kind = "expression";
      bodyOffset += 1;
    } else if (raw.startsWith("<%!")) {
      kind = "declaration";
      bodyOffset += 1;
    }

    const trimmed = body.trim();
    const leadingWhitespace = body.length - body.trimStart().length;
    const trailingWhitespace = body.length - body.trimEnd().length;
    const startOffset = bodyOffset + leadingWhitespace;
    const endOffset = match.index + raw.length - 2 - trailingWhitespace;

    blocks.push({
      kind,
      code: trimmed,
      location: toLocation(content, startOffset, endOffset),
      codeOffset: startOffset
    });
  }

  return blocks;
}

function normalizePath(target: string): string {
  return target.split(path.sep).join("/");
}

function toLocation(content: string, startOffset: number, endOffset: number): SourceLocation {
  const start = offsetToLineColumn(content, startOffset);
  const end = offsetToLineColumn(content, Math.max(startOffset, endOffset - 1));

  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column
  };
}

function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return { line, column };
}
