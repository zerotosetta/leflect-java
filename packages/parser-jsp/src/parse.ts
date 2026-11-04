import fs from "fs/promises";
import path from "path";

import { JspAstMode, LineRange, TldAttributeSchema } from "@leflect-java/schema";

import { parseEl } from "./el";

export type JspDirective = {
  kind: "taglib" | "page" | "include" | "tag" | "attribute";
  attributes: Record<string, string>;
  raw: string;
  location: SourceLocation;
};

export type TaglibDirective = {
  prefix: string;
  uri: string;
  location: SourceLocation;
  sourcePath?: string;
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
  | JspCommentNode
  | JspHtmlElementNode
  | JspCustomTagElementNode
  | JspDirectiveNode
  | JspIncludeDirectiveNode
  | JspScriptletNode
  | JspExpressionNode
  | JspDeclarationNode
  | JspElExpressionNode
  | JspAttributeNode;

export type JspParserDiagnostic = {
  code: string;
  message: string;
  lineRange: LineRange;
};

export type JspAttributeNode = {
  kind: "Attribute";
  name?: string;
  raw: string;
  value?: string;
  lineRange: LineRange;
  children: JspDocumentNode[];
  incomplete?: boolean;
};

export type JspDocumentRoot = {
  kind: "Document";
  raw: string;
  lineRange: LineRange;
  children: JspDocumentNode[];
  diagnostics?: JspParserDiagnostic[];
};

export type JspTextNode = {
  kind: "Text";
  raw: string;
  text: string;
  lineRange: LineRange;
};

export type JspCommentNode = {
  kind: "Comment";
  raw: string;
  text: string;
  lineRange: LineRange;
};

export type JspHtmlElementNode = {
  kind: "HtmlElement";
  raw: string;
  tagName: string;
  attributes: Record<string, string>;
  attributeNodes?: JspAttributeNode[];
  lineRange: LineRange;
  children: JspDocumentNode[];
  selfClosing?: boolean;
  incomplete?: boolean;
};

export type JspCustomTagElementNode = {
  kind: "CustomTagElement";
  raw: string;
  prefix: string;
  name: string;
  attributes: Record<string, string>;
  attributeNodes?: JspAttributeNode[];
  lineRange: LineRange;
  children: JspDocumentNode[];
  selfClosing?: boolean;
  incomplete?: boolean;
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
  incomplete?: boolean;
};

export type JspParseResult = {
  sourceKind?: "jsp" | "jspf" | "tag" | "tagx";
  tagAttributes?: TldAttributeSchema[];
  directives: JspDirective[];
  imports: string[];
  includes: string[];
  taglibs: TaglibDirective[];
  tags: JspTag[];
  scriptlets: ScriptletBlock[];
  document: JspDocumentRoot;
  ast?: JspAstReference;
};

export type JspParseOptions = {
  sourceKind?: NonNullable<JspParseResult["sourceKind"]>;
  syntax?: "html" | "xml";
};

const DIRECTIVE_REGEX = /<%@\s*([a-zA-Z0-9_]+)\s+([^%]*)%>/gi;
const TAG_REGEX = /<([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)(\s|>|\/)/g;
const SCRIPTLET_REGEX = /<%([\s\S]*?)%>/g;
const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr"
]);
const HTML_OPTIONAL_END_ELEMENTS = new Set([
  "html", "head", "body", "p", "li", "dt", "dd", "rb", "rt", "rtc", "rp",
  "optgroup", "option", "colgroup", "thead", "tbody", "tfoot", "tr", "td", "th"
]);

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
  startTagEnd: number;
  identifier: string;
};

export function parseJsp(content: string, options: JspParseOptions = {}): JspParseResult {
  const commentRanges: Array<{ start: number; end: number }> = [];
  const diagnostics: JspParserDiagnostic[] = [];
  const xml = options.syntax === "xml" || options.sourceKind === "tagx" ||
    /^\s*<\?xml\b/.test(content) || /<jsp:root\b/.test(content);
  const document = parseDocument(content, commentRanges, diagnostics, xml);
  document.diagnostics = diagnostics;
  let visibleContent = "";
  let cursor = 0;
  for (const { start, end } of commentRanges) {
    // Preserve offsets and line numbers for metadata extracted from the rest of the JSP.
    visibleContent += content.slice(cursor, start) + content.slice(start, end).replace(/[^\r\n]/g, " ");
    cursor = end;
  }
  visibleContent += content.slice(cursor);
  const directives = extractDirectives(visibleContent);
  return {
    sourceKind: options.sourceKind ?? "jsp",
    tagAttributes: directives.filter((directive) => directive.kind === "attribute" && directive.attributes.name)
      .map(({ attributes }) => ({
        name: attributes.name,
        required: attributes.required === "true",
        type: attributes.type ?? "java.lang.String",
        runtimeExpressionValue: attributes.rtexprvalue !== "false"
      })),
    directives,
    imports: extractImports(directives),
    includes: extractIncludes(directives),
    taglibs: extractTaglibs(directives),
    tags: extractTags(visibleContent),
    scriptlets: extractScriptlets(visibleContent),
    document
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
    const attributes = extractLooseAttributes(attrs);

    if (kind === "taglib" || kind === "page" || kind === "include" || kind === "tag" || kind === "attribute") {
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

function extractImports(directives: JspDirective[]): string[] {
  const imports = new Set<string>();

  for (const directive of directives) {
    if (directive.kind !== "page" && directive.kind !== "tag") {
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

function parseDocument(
  content: string,
  commentRanges: Array<{ start: number; end: number }>,
  diagnostics: JspParserDiagnostic[],
  xml: boolean,
  startOffset = 0,
  endOffset = content.length,
  attributeValue = false
): JspDocumentRoot {
  const root: JspDocumentRoot = {
    kind: "Document",
    raw: content.slice(startOffset, endOffset),
    lineRange: toLineRange(content, startOffset, endOffset),
    children: []
  };
  const stack: StackEntry[] = [];
  let index = startOffset;

  while (index < endOffset) {
    const current = currentContainer(root, stack);

    if (content.startsWith("<%--", index)) {
      const end = Math.min(endOffset, findSequenceEnd(content, index + 4, "--%>"));
      const raw = content.slice(index, end);
      commentRanges.push({ start: index, end });
      current.children.push({
        kind: "Comment",
        raw,
        text: raw.endsWith("--%>") ? raw.slice(4, -4) : raw.slice(4),
        lineRange: toLineRange(content, index, end)
      });
      index = end;
      continue;
    }

    if (content.startsWith("<%@", index)) {
      const end = Math.min(endOffset, findSequenceEnd(content, index, "%>"));
      const raw = content.slice(index, end);
      const directive = parseDirectiveNode(content, raw, index, end);
      current.children.push(directive);
      index = end;
      continue;
    }

    if (content.startsWith("<%=", index) || content.startsWith("<%!", index) || content.startsWith("<%", index)) {
      const end = Math.min(endOffset, findSequenceEnd(content, index, "%>"));
      const node = parseScriptletNode(content, index, end);
      current.children.push(node);
      index = end;
      continue;
    }

    if (attributeValue && content[index] === "<" && !/^<\/?[\w-]+:/.test(content.slice(index))) {
      const next = Math.min(endOffset, findNextSpecialIndex(content, index + 1, true));
      index = pushTextNodes(content, current.children, index, next);
      continue;
    }

    if (content.startsWith("</", index)) {
      const close = parseClosingTag(content, index, endOffset, xml);
      if (!close) {
        index = pushTextNodes(content, current.children, index, index + 2);
        continue;
      }
      closeElement(stack, close.identifier, content, close.end, diagnostics);
      index = close.end;
      continue;
    }

    if (content[index] === "<") {
      const open = parseElementNode(content, index, endOffset, commentRanges, diagnostics, xml);
      if (!open) {
        index = pushTextNodes(content, current.children, index, index + 1);
        continue;
      }

      current.children.push(open.node);
      index = open.end;
      if (!open.node.selfClosing && !open.node.incomplete) {
        stack.push({
          node: open.node,
          startOffset: index - open.raw.length,
          startTagEnd: open.end,
          identifier: open.identifier
        });
      }
      continue;
    }

    if (content.startsWith("${", index) || content.startsWith("#{", index)) {
      const end = findElExpressionEnd(content, index, endOffset);
      current.children.push(createElExpressionNode(content, index, end, diagnostics));
      index = end;
      continue;
    }

    const next = Math.min(endOffset, findNextSpecialIndex(content, index, attributeValue));
    index = pushTextNodes(content, current.children, index, next);
  }

  closeElement(stack, undefined, content, endOffset, diagnostics);
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

function createElExpressionNode(
  content: string,
  startOffset: number,
  endOffset: number,
  diagnostics?: JspParserDiagnostic[]
): JspElExpressionNode {
  const raw = content.slice(startOffset, endOffset);
  const ast = parseEl(raw);
  const incomplete = !raw.endsWith("}");
  if (incomplete || ast.kind === "RawExpression" || ast.kind === "UnknownExpression") {
    diagnostics?.push({
      code: incomplete ? "incomplete-el" : "unsupported-el",
      message: incomplete ? "EL expression is not closed" : "EL expression could not be structured",
      lineRange: toLineRange(content, startOffset, endOffset)
    });
  }
  return {
    kind: "ElExpression",
    raw,
    expression: raw,
    ast,
    ...(incomplete ? { incomplete: true } : {}),
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

function parseClosingTag(content: string, startOffset: number, limit: number, xml: boolean): { identifier: string; end: number } | undefined {
  const end = findTagBoundary(content, startOffset, limit);
  const raw = content.slice(startOffset, end);
  const match = raw.match(/^<\/\s*([A-Za-z0-9:_-]+)[^>]*>$/);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    identifier: xml || match[1].includes(":") ? match[1] : match[1].toLowerCase(),
    end
  };
}

function parseElementNode(
  content: string,
  startOffset: number,
  limit: number,
  commentRanges: Array<{ start: number; end: number }>,
  diagnostics: JspParserDiagnostic[],
  xml: boolean
): { node: JspHtmlElementNode | JspCustomTagElementNode; identifier: string; raw: string; end: number } | undefined {
  if (content.startsWith("<!--", startOffset) || content.startsWith("<!DOCTYPE", startOffset)) {
    return undefined;
  }

  const end = findTagBoundary(content, startOffset, limit);
  const raw = content.slice(startOffset, end);
  const match = raw.match(/^<\s*([A-Za-z0-9:_-]+)/);
  if (!match?.[1]) {
    return undefined;
  }

  const identifier = match[1];
  const complete = raw.endsWith(">");
  const attributesStart = startOffset + match[0].length;
  const attributesEnd = complete ? end - (raw.endsWith("/>") ? 2 : 1) : end;
  const parsedAttributes = parseElementAttributes(
    content, attributesStart, attributesEnd, commentRanges, diagnostics, xml
  );
  const attributes = parsedAttributes.attributes;
  const selfClosing = raw.endsWith("/>") || (!xml && !identifier.includes(":") && HTML_VOID_ELEMENTS.has(identifier.toLowerCase()));
  const incomplete = !complete || parsedAttributes.incomplete;
  if (incomplete) {
    diagnostics.push({
      code: "incomplete-tag",
      message: `Element ${identifier} has an incomplete start tag`,
      lineRange: toLineRange(content, startOffset, end)
    });
  }
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
        attributeNodes: parsedAttributes.nodes,
        children: [],
        selfClosing,
        ...(incomplete ? { incomplete: true } : {}),
        lineRange
      }
    };
  }

  return {
    identifier: xml ? identifier : identifier.toLowerCase(),
    raw,
    end,
    node: {
      kind: "HtmlElement",
      raw,
      tagName: identifier,
      attributes,
      attributeNodes: parsedAttributes.nodes,
      children: [],
      selfClosing,
      ...(incomplete ? { incomplete: true } : {}),
      lineRange
    }
  };
}

function closeElement(
  stack: StackEntry[],
  identifier: string | undefined,
  content: string,
  endOffset: number,
  diagnostics: JspParserDiagnostic[]
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
      markUnclosed(entry, content, diagnostics);
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
    if (entry.identifier !== identifier) {
      markUnclosed(entry, content, diagnostics);
    }
    if (entry.identifier === identifier) {
      break;
    }
  }
}

function markUnclosed(entry: StackEntry, content: string, diagnostics: JspParserDiagnostic[]): void {
  if (entry.node.kind === "HtmlElement" && HTML_OPTIONAL_END_ELEMENTS.has(entry.node.tagName.toLowerCase())) {
    return;
  }
  entry.node.incomplete = true;
  diagnostics.push({
    code: "unclosed-element",
    message: `Element ${entry.identifier} has no matching end tag`,
    lineRange: toLineRange(content, entry.startOffset, entry.startTagEnd)
  });
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

function parseElementAttributes(
  content: string,
  start: number,
  end: number,
  commentRanges: Array<{ start: number; end: number }>,
  diagnostics: JspParserDiagnostic[],
  xml: boolean
): { attributes: Record<string, string>; nodes: JspAttributeNode[]; incomplete: boolean } {
  const attributes: Record<string, string> = {};
  const nodes: JspAttributeNode[] = [];
  let index = start;
  let incomplete = false;
  while (index < end) {
    while (index < end && /\s/.test(content[index])) index += 1;
    if (index >= end) break;
    const nodeStart = index;
    if (content.startsWith("${", index) || content.startsWith("#{", index)) {
      const expressionEnd = findElExpressionEnd(content, index, end);
      const expression = createElExpressionNode(content, index, expressionEnd, diagnostics);
      nodes.push({
        kind: "Attribute",
        raw: expression.raw,
        lineRange: expression.lineRange,
        children: [expression],
        ...(expression.incomplete ? { incomplete: true } : {})
      });
      incomplete ||= Boolean(expression.incomplete);
      index = expressionEnd;
      continue;
    }

    while (index < end && /[^\s=/>]/.test(content[index])) index += 1;
    const name = content.slice(nodeStart, index);
    if (!name) {
      index += 1;
      continue;
    }
    while (index < end && /\s/.test(content[index])) index += 1;
    if (content[index] !== "=" || index >= end) {
      attributes[name] = "true";
      nodes.push({
        kind: "Attribute", name, raw: content.slice(nodeStart, index),
        value: "true", lineRange: toLineRange(content, nodeStart, index), children: []
      });
      continue;
    }
    index += 1;
    while (index < end && /\s/.test(content[index])) index += 1;
    const quote = content[index];
    const quoted = quote === "'" || quote === '"';
    if (quoted) index += 1;
    const valueStart = index;
    while (index < end) {
      if (content.startsWith("<%", index)) {
        index = Math.min(end, findSequenceEnd(content, index, "%>"));
        continue;
      }
      if (content.startsWith("${", index) || content.startsWith("#{", index)) {
        index = findElExpressionEnd(content, index, end, quoted ? quote : undefined);
        continue;
      }
      if (content[index] === "<" && /^<\s*[\w-]+:/.test(content.slice(index))) {
        index = findTagBoundary(content, index, end);
        continue;
      }
      if (quoted && content[index] === "\\") {
        index = Math.min(end, index + 2);
        continue;
      }
      if (quoted ? content[index] === quote : /\s/.test(content[index])) break;
      index += 1;
    }
    const valueEnd = index;
    const closed = !quoted || content[index] === quote;
    if (quoted && closed) index += 1;
    const value = content.slice(valueStart, valueEnd);
    attributes[name] = value;
    const children = parseDocument(content, commentRanges, diagnostics, xml, valueStart, valueEnd, true).children;
    const valueIncomplete = !closed || children.some((node) => "incomplete" in node && node.incomplete);
    nodes.push({
      kind: "Attribute", name, value, raw: content.slice(nodeStart, index),
      lineRange: toLineRange(content, nodeStart, index), children,
      ...(valueIncomplete ? { incomplete: true } : {})
    });
    incomplete ||= valueIncomplete;
  }
  return { attributes, nodes, incomplete };
}

function findTagBoundary(content: string, startOffset: number, limit = content.length): number {
  let index = startOffset + 1;
  let quote: string | undefined;

  while (index < limit) {
    const char = content[index];
    if (content.startsWith("<%", index)) {
      index = Math.min(limit, findSequenceEnd(content, index, "%>"));
      continue;
    }
    if (content.startsWith("${", index) || content.startsWith("#{", index)) {
      index = findElExpressionEnd(content, index, limit, quote);
      continue;
    }
    if (quote) {
      if (char === "<" && /^<\s*[\w-]+:/.test(content.slice(index))) {
        index = findTagBoundary(content, index, limit);
        continue;
      }
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
    if (char === "<") {
      return index;
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

  // A broken quoted start tag must not consume later sibling elements.
  return findRecoveryMarkup(content, startOffset + 1, limit) ?? limit;
}

function findSequenceEnd(content: string, startOffset: number, terminator: string): number {
  const index = content.indexOf(terminator, startOffset);
  return index < 0 ? content.length : index + terminator.length;
}

function findNextSpecialIndex(content: string, startOffset: number, attributeValue = false): number {
  const jspMarkup = /<(?:%|\/?[\w-]+:)/g;
  jspMarkup.lastIndex = startOffset;
  const markup = attributeValue ? jspMarkup.exec(content)?.index ?? -1 : content.indexOf("<", startOffset);
  const candidates = [
    markup,
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

function findElExpressionEnd(content: string, startOffset: number, limit = content.length, attributeQuote?: string): number {
  let index = startOffset + 2;
  let quote: string | undefined;
  let depth = 1;

  while (index < limit) {
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

    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index + 1;

    index += 1;
  }

  const recovery = findRecoveryMarkup(content, startOffset + 2, limit) ?? limit;
  if (attributeQuote) {
    for (let candidate = content.indexOf(attributeQuote, startOffset + 2); candidate >= 0 && candidate < recovery;
      candidate = content.indexOf(attributeQuote, candidate + 1)) {
      if (content[candidate - 1] !== "\\" && (candidate + 1 === limit || /^\s*(?:\/?>|[\w:-]+\s*=)/.test(content.slice(candidate + 1, limit)))) {
        return candidate;
      }
    }
  }
  return recovery;
}

function findRecoveryMarkup(content: string, start: number, limit: number): number | undefined {
  const markup = /<\/?[A-Za-z][\w:.-]*(?=[\s/>])/g;
  markup.lastIndex = start;
  const match = markup.exec(content);
  if (!match || match.index >= limit) return undefined;
  const preceding = content.slice(start, match.index).match(/\r?\n[\t ]*$/);
  return preceding ? match.index - preceding[0].length : match.index;
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
