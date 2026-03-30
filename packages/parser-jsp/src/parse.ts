import fs from "fs/promises";
import path from "path";

import { JspAstMode, LineRange } from "@leflect-java/schema";

import { parseEl } from "./el";

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

export type JspDocumentNode =
  | JspDocumentRoot
  | JspTextNode
  | JspHtmlElementNode
  | JspCustomTagElementNode
  | JspDirectiveNode
  | JspIncludeDirectiveNode
  | JspScriptletNode
  | JspExpressionNode
  | JspDeclarationNode
  | JspElExpressionNode;

export type JspDocumentRoot = {
  kind: "Document";
  raw: string;
  lineRange: LineRange;
  children: JspDocumentNode[];
};

export type JspTextNode = {
  kind: "Text";
  raw: string;
  text: string;
  lineRange: LineRange;
};

export type JspHtmlElementNode = {
  kind: "HtmlElement";
  raw: string;
  tagName: string;
  attributes: Record<string, string>;
  lineRange: LineRange;
  children: JspDocumentNode[];
  selfClosing?: boolean;
};

export type JspCustomTagElementNode = {
  kind: "CustomTagElement";
  raw: string;
  prefix: string;
  name: string;
  attributes: Record<string, string>;
  lineRange: LineRange;
  children: JspDocumentNode[];
  selfClosing?: boolean;
};

export type JspDirectiveNode = {
  kind: "Directive";
  raw: string;
  directiveKind: string;
  attributes: Record<string, string>;
  lineRange: LineRange;
};

export type JspIncludeDirectiveNode = {
  kind: "IncludeDirective";
  raw: string;
  attributes: Record<string, string>;
  target?: string;
  lineRange: LineRange;
};

export type JspScriptletNode = {
  kind: "Scriptlet";
  raw: string;
  code: string;
  lineRange: LineRange;
  codeOffset: number;
};

export type JspExpressionNode = {
  kind: "Expression";
  raw: string;
  code: string;
  lineRange: LineRange;
  codeOffset: number;
};

export type JspDeclarationNode = {
  kind: "Declaration";
  raw: string;
  code: string;
  lineRange: LineRange;
  codeOffset: number;
};

export type JspElExpressionNode = {
  kind: "ElExpression";
  raw: string;
  expression: string;
  lineRange: LineRange;
  ast: ReturnType<typeof parseEl>;
};

export type JspParseResult = {
  directives: JspDirective[];
  imports: string[];
  includes: string[];
  taglibs: TaglibDirective[];
  tags: JspTag[];
  scriptlets: ScriptletBlock[];
  document: JspDocumentRoot;
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

type ContainerNode = JspDocumentRoot | JspHtmlElementNode | JspCustomTagElementNode;

type StackEntry = {
  node: Exclude<ContainerNode, JspDocumentRoot>;
  startOffset: number;
  identifier: string;
};

export function parseJsp(content: string): JspParseResult {
  const directives = extractDirectives(content);
  return {
    directives,
    imports: extractImports(directives),
    includes: extractIncludes(directives),
    taglibs: extractTaglibs(directives),
    tags: extractTags(content),
    scriptlets: extractScriptlets(content),
    document: parseDocument(content)
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

function parseDocument(content: string): JspDocumentRoot {
  const root: JspDocumentRoot = {
    kind: "Document",
    raw: content,
    lineRange: toLineRange(content, 0, content.length),
    children: []
  };
  const stack: StackEntry[] = [];
  let index = 0;

  while (index < content.length) {
    const current = currentContainer(root, stack);

    if (content.startsWith("<%@", index)) {
      const end = findSequenceEnd(content, index, "%>");
      const raw = content.slice(index, end);
      const directive = parseDirectiveNode(content, raw, index, end);
      current.children.push(directive);
      index = end;
      continue;
    }

    if (content.startsWith("<%=", index) || content.startsWith("<%!", index) || content.startsWith("<%", index)) {
      const end = findSequenceEnd(content, index, "%>");
      const node = parseScriptletNode(content, index, end);
      current.children.push(node);
      index = end;
      continue;
    }

    if (content.startsWith("</", index)) {
      const close = parseClosingTag(content, index);
      if (!close) {
        index = pushTextNodes(content, current.children, index, index + 2);
        continue;
      }
      closeElement(stack, close.identifier, content, close.end);
      index = close.end;
      continue;
    }

    if (content[index] === "<") {
      const open = parseElementNode(content, index);
      if (!open) {
        index = pushTextNodes(content, current.children, index, index + 1);
        continue;
      }

      current.children.push(open.node);
      index = open.end;
      if (!open.node.selfClosing) {
        stack.push({
          node: open.node,
          startOffset: index - open.raw.length,
          identifier: open.identifier
        });
      }
      continue;
    }

    if (content.startsWith("${", index) || content.startsWith("#{", index)) {
      const end = findElExpressionEnd(content, index);
      current.children.push(createElExpressionNode(content, index, end));
      index = end;
      continue;
    }

    const next = findNextSpecialIndex(content, index);
    index = pushTextNodes(content, current.children, index, next);
  }

  closeElement(stack, undefined, content, content.length);
  return root;
}

function pushTextNodes(
  content: string,
  children: JspDocumentNode[],
  startOffset: number,
  endOffset: number
): number {
  for (const node of splitTextNodes(content, startOffset, endOffset)) {
    children.push(node);
  }
  return endOffset;
}

function splitTextNodes(content: string, startOffset: number, endOffset: number): JspDocumentNode[] {
  const nodes: JspDocumentNode[] = [];
  let index = startOffset;

  while (index < endOffset) {
    const nextEl = findNextElStart(content, index, endOffset);
    if (nextEl < 0) {
      const raw = content.slice(index, endOffset);
      if (raw) {
        nodes.push({
          kind: "Text",
          raw,
          text: raw,
          lineRange: toLineRange(content, index, endOffset)
        });
      }
      break;
    }

    if (nextEl > index) {
      const raw = content.slice(index, nextEl);
      nodes.push({
        kind: "Text",
        raw,
        text: raw,
        lineRange: toLineRange(content, index, nextEl)
      });
    }

    const elEnd = findElExpressionEnd(content, nextEl);
    nodes.push(createElExpressionNode(content, nextEl, elEnd));
    index = elEnd;
  }

  return nodes.filter((node) => !(node.kind === "Text" && node.raw.length === 0));
}

function createElExpressionNode(content: string, startOffset: number, endOffset: number): JspElExpressionNode {
  const raw = content.slice(startOffset, endOffset);
  return {
    kind: "ElExpression",
    raw,
    expression: raw,
    ast: parseEl(raw),
    lineRange: toLineRange(content, startOffset, endOffset)
  };
}

function parseDirectiveNode(
  content: string,
  raw: string,
  startOffset: number,
  endOffset: number
): JspDirectiveNode | JspIncludeDirectiveNode {
  const match = raw.match(/^<%@\s*([a-zA-Z0-9_]+)\s*([\s\S]*?)%>$/);
  const directiveKind = match?.[1] ?? "unknown";
  const attributes = extractLooseAttributes(match?.[2] ?? "");
  const lineRange = toLineRange(content, startOffset, endOffset);

  if (directiveKind === "include") {
    return {
      kind: "IncludeDirective",
      raw,
      attributes,
      target: attributes["file"],
      lineRange
    };
  }

  return {
    kind: "Directive",
    raw,
    directiveKind,
    attributes,
    lineRange
  };
}

function parseScriptletNode(
  content: string,
  startOffset: number,
  endOffset: number
): JspScriptletNode | JspExpressionNode | JspDeclarationNode {
  const raw = content.slice(startOffset, endOffset);
  const body = raw.slice(raw.startsWith("<%!") || raw.startsWith("<%=") ? 3 : 2, -2);
  const leadingWhitespace = body.length - body.trimStart().length;
  const trailingWhitespace = body.length - body.trimEnd().length;
  const code = body.trim();
  const codeOffset = startOffset + (raw.startsWith("<%!") || raw.startsWith("<%=") ? 3 : 2) + leadingWhitespace;
  const lineRange = toLineRange(content, codeOffset, endOffset - 2 - trailingWhitespace);

  if (raw.startsWith("<%=")) {
    return {
      kind: "Expression",
      raw,
      code,
      lineRange,
      codeOffset
    };
  }
  if (raw.startsWith("<%!")) {
    return {
      kind: "Declaration",
      raw,
      code,
      lineRange,
      codeOffset
    };
  }
  return {
    kind: "Scriptlet",
    raw,
    code,
    lineRange,
    codeOffset
  };
}

function parseClosingTag(content: string, startOffset: number): { identifier: string; end: number } | undefined {
  const end = findTagBoundary(content, startOffset);
  const raw = content.slice(startOffset, end);
  const match = raw.match(/^<\/\s*([A-Za-z0-9:_-]+)[^>]*>$/);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    identifier: match[1],
    end
  };
}

function parseElementNode(
  content: string,
  startOffset: number
): { node: JspHtmlElementNode | JspCustomTagElementNode; identifier: string; raw: string; end: number } | undefined {
  if (content.startsWith("<!--", startOffset) || content.startsWith("<!DOCTYPE", startOffset)) {
    return undefined;
  }

  const end = findTagBoundary(content, startOffset);
  const raw = content.slice(startOffset, end);
  const match = raw.match(/^<\s*([A-Za-z0-9:_-]+)([\s\S]*?)(\/?)>$/);
  if (!match?.[1]) {
    return undefined;
  }

  const identifier = match[1];
  const attributes = extractLooseAttributes(match[2] ?? "");
  const selfClosing = Boolean(match[3]) || raw.endsWith("/>");
  const lineRange = toLineRange(content, startOffset, end);

  if (identifier.includes(":")) {
    const [prefix, name] = identifier.split(":", 2);
    return {
      identifier,
      raw,
      end,
      node: {
        kind: "CustomTagElement",
        raw,
        prefix,
        name,
        attributes,
        children: [],
        selfClosing,
        lineRange
      }
    };
  }

  return {
    identifier,
    raw,
    end,
    node: {
      kind: "HtmlElement",
      raw,
      tagName: identifier,
      attributes,
      children: [],
      selfClosing,
      lineRange
    }
  };
}

function closeElement(
  stack: StackEntry[],
  identifier: string | undefined,
  content: string,
  endOffset: number
): void {
  if (stack.length === 0) {
    return;
  }

  if (!identifier) {
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) {
        break;
      }
      finalizeContainerNode(entry.node, content, entry.startOffset, endOffset);
    }
    return;
  }

  const matchIndex = [...stack].reverse().findIndex((entry) => entry.identifier === identifier);
  if (matchIndex < 0) {
    return;
  }

  const popCount = matchIndex + 1;
  for (let index = 0; index < popCount; index += 1) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    finalizeContainerNode(entry.node, content, entry.startOffset, endOffset);
    if (entry.identifier === identifier) {
      break;
    }
  }
}

function finalizeContainerNode(
  node: JspHtmlElementNode | JspCustomTagElementNode,
  content: string,
  startOffset: number,
  endOffset: number
): void {
  node.raw = content.slice(startOffset, endOffset);
  node.lineRange = toLineRange(content, startOffset, endOffset);
}

function currentContainer(root: JspDocumentRoot, stack: StackEntry[]): ContainerNode {
  return stack[stack.length - 1]?.node ?? root;
}

function extractLooseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }
    if (index >= source.length || source[index] === "/") {
      break;
    }

    const nameStart = index;
    while (index < source.length && /[^\s=/]/.test(source[index])) {
      index += 1;
    }
    const name = source.slice(nameStart, index).trim();
    if (!name) {
      index += 1;
      continue;
    }

    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }

    if (source[index] !== "=") {
      attributes[name] = "true";
      continue;
    }

    index += 1;
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }

    if (index >= source.length) {
      attributes[name] = "";
      break;
    }

    const quote = source[index];
    if (quote === "\"" || quote === "'") {
      index += 1;
      const valueStart = index;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          break;
        }
        index += 1;
      }
      attributes[name] = source.slice(valueStart, index);
      index += 1;
      continue;
    }

    const valueStart = index;
    while (index < source.length && /[^\s>]/.test(source[index])) {
      index += 1;
    }
    attributes[name] = source.slice(valueStart, index);
  }

  return attributes;
}

function findTagBoundary(content: string, startOffset: number): number {
  let index = startOffset + 1;
  let quote: string | undefined;

  while (index < content.length) {
    const char = content[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === ">") {
      return index + 1;
    }

    index += 1;
  }

  return content.length;
}

function findSequenceEnd(content: string, startOffset: number, terminator: string): number {
  const index = content.indexOf(terminator, startOffset);
  return index < 0 ? content.length : index + terminator.length;
}

function findNextSpecialIndex(content: string, startOffset: number): number {
  const candidates = [
    content.indexOf("<", startOffset),
    content.indexOf("${", startOffset),
    content.indexOf("#{", startOffset)
  ].filter((value) => value >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : content.length;
}

function findNextElStart(content: string, startOffset: number, endOffset: number): number {
  const dollar = content.indexOf("${", startOffset);
  const hash = content.indexOf("#{", startOffset);
  const matches = [dollar, hash].filter((value) => value >= 0 && value < endOffset);
  return matches.length > 0 ? Math.min(...matches) : -1;
}

function findElExpressionEnd(content: string, startOffset: number): number {
  let index = startOffset + 2;
  let quote: string | undefined;

  while (index < content.length) {
    const char = content[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "}") {
      return index + 1;
    }

    index += 1;
  }

  return content.length;
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

function toLineRange(content: string, startOffset: number, endOffset: number): LineRange {
  const start = offsetToLineColumn(content, startOffset);
  const end = offsetToLineColumn(content, Math.max(startOffset, endOffset - 1));

  return {
    startLine: start.line,
    startColumn: start.column,
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
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export { parseEl } from "./el";
