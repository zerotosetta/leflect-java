import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";

import { buildJavaCommand } from "@leflect-java/java-bridge";
import { parseJsp, type JspDocumentNode } from "@leflect-java/parser-jsp";
import type { ElAstNode, LeflectConfig, LineRange } from "@leflect-java/schema";

import { resolveJavaWorkerJar } from "./worker-jar";

export type SyntaxLocation = { line: number; column: number; endLine: number; endColumn: number };
export type SyntaxDiagnostic = { code: string; message: string; location?: SyntaxLocation };
export type SyntaxImport = { name: string; wildcard: boolean; static: boolean; location: SyntaxLocation };
export type SyntaxInclude = {
  expression: string;
  kind: "translation" | "request";
  dynamic: boolean;
  location: SyntaxLocation;
};
export type SyntaxType = {
  expression: string;
  location: SyntaxLocation;
  shadowed?: boolean;
  resolvedName?: string;
  role?: "type" | "qualifier";
  enclosingTypes: string[];
  inheritanceUncertain?: boolean;
};
export type JavaSyntax = {
  packageName: string;
  imports: SyntaxImport[];
  declarations: {
    className: string;
    location: SyntaxLocation;
    access: "public" | "protected" | "private" | "package";
    superTypes: string[];
  }[];
  types: SyntaxType[];
  diagnostics: SyntaxDiagnostic[];
};
export type JspScriptlet = {
  kind: "scriptlet" | "expression" | "declaration";
  code: string;
  codeOffset: number;
  originOffsets?: number[];
};
export type JspSyntax = {
  imports: SyntaxImport[];
  includes: SyntaxInclude[];
  scriptlets: JspScriptlet[];
  diagnostics: SyntaxDiagnostic[];
};
export type JspJavaPart = { text: string; scriptlet: JspScriptlet };
export type JspJavaSyntax = {
  types: (SyntaxType & { partIndex: number })[];
  diagnostics: (SyntaxDiagnostic & { partIndex?: number })[];
};

const JAVA_IDENTIFIER = "[\\p{ID_Start}$_][\\p{ID_Continue}$_\\u200C\\u200D]*";
const JAVA_IMPORT = new RegExp(`^(${JAVA_IDENTIFIER}(?:\\.${JAVA_IDENTIFIER})*)(\\.\\*)?$`, "u");
const JSP_XML_NAMESPACES = new Set(["http://java.sun.com/JSP/Page", "http://xmlns.jcp.org/JSP/Page", "jakarta.tags.jsp"]);
const XML_SCRIPTLET = /^(scriptlet|expression|declaration)$/;
const JSP_SYNTAX_TAGS = new Set(["root", "include", "param", "text", "scriptlet", "declaration", "expression"]);

export function parseJspSyntax(text: string, logicalPath: string): JspSyntax {
  const xml = /\.(?:jspx|tagx)$/i.test(logicalPath) || /^\s*<\?xml\b/.test(text) || /<jsp:root\b/.test(text);
  const { document } = parseJsp(text, { syntax: xml ? "xml" : "html" });
  const jspPositions = sourcePositions(text, /\n/g);
  const positions = sourcePositions(text);
  const result: JspSyntax = { imports: [], includes: [], scriptlets: [], diagnostics: [] };

  function fromJspRange(range: LineRange): SyntaxLocation {
    return positions.range(
      jspPositions.offset(range.startLine, range.startColumn ?? 1),
      jspPositions.offset(range.endLine, range.endColumn ?? 1)
    );
  }

  for (const issue of document.diagnostics ?? []) {
    result.diagnostics.push({ code: "SOURCE_JSP_SYNTAX", message: issue.message, location: fromJspRange(issue.lineRange) });
  }

  function imports(raw: string, offset: number, xmlDirective: boolean): void {
    const opening = (xmlDirective ? /^<[^\s/>]+/ : /^<%@\s*\w+/).exec(raw);
    if (!opening) return;
    const attributes = xmlDirective
      ? /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
      : /\s+([^\s=/>]+)\s*=\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')/y;
    attributes.lastIndex = opening[0].length;
    let attribute = attributes.exec(raw);
    while (attribute && attribute[1] !== "import") attribute = attributes.exec(raw);
    if (!attribute) return;
    const value = attribute[2] ?? attribute[3];
    const valueOffset = offset + attribute.index + attribute[0].length - value.length - 1;
    for (const item of value.matchAll(/[^,]+/g)) {
      const spelling = item[0].trim();
      if (!spelling) continue;
      const expression = xmlDirective ? decodeXml(spelling, 0).code : spelling;
      const start = valueOffset + item.index + item[0].indexOf(spelling);
      const location = positions.range(start, start + spelling.length - 1);
      const match = JAVA_IMPORT.exec(expression);
      if (!match) {
        result.diagnostics.push({ code: "SOURCE_JSP_IMPORT", message: `Unsupported JSP import ${expression}`, location });
        continue;
      }
      result.imports.push({ name: match[1], wildcard: !!match[2], static: false, location });
    }
  }

  function include(value: string | undefined, kind: SyntaxInclude["kind"], location: SyntaxLocation): void {
    const expression = value?.trim() ?? "";
    if (!expression) {
      result.diagnostics.push({ code: "SOURCE_JSP_INCLUDE", message: "JSP include has no target path", location });
      return;
    }
    result.includes.push({ expression, kind, dynamic: /(?:\$|#)\{|<%/.test(expression), location });
  }

  function visit(node: JspDocumentNode, namespaces: ReadonlySet<string>): void {
    const start = jspPositions.offset(node.lineRange.startLine, node.lineRange.startColumn ?? 1);
    if (node.kind === "Directive" && ["page", "tag"].includes(node.directiveKind)) imports(node.raw, start, false);
    if (node.kind === "IncludeDirective") include(node.target, "translation", fromJspRange(node.lineRange));
    if (node.kind === "ElExpression" && hasElCall(node.ast)) {
      result.diagnostics.push({
        code: "SOURCE_JSP_EL_CONTEXT", message: "Resolving an EL call requires the JSP container's function or object bindings.",
        location: fromJspRange(node.lineRange)
      });
    }
    if (node.kind === "Scriptlet" || node.kind === "Declaration" || node.kind === "Expression") {
      const kind = node.kind === "Scriptlet" ? "scriptlet" : node.kind === "Expression" ? "expression" : "declaration";
      result.scriptlets.push({ kind, code: node.code, codeOffset: node.codeOffset });
    }
    if (node.kind === "HtmlElement" || node.kind === "CustomTagElement") {
      for (const [name, value] of Object.entries(node.attributes)) {
        if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
        const prefix = name === "xmlns" ? "" : name.slice(6);
        const declared = new Set(namespaces);
        if (JSP_XML_NAMESPACES.has(value)) declared.add(prefix);
        else declared.delete(prefix);
        namespaces = declared;
      }
    }
    if ((node.kind === "CustomTagElement" && namespaces.has(node.prefix)) ||
        (xml && node.kind === "HtmlElement" && namespaces.has(""))) {
      const name = node.kind === "CustomTagElement" ? node.name : node.tagName;
      const tagEnd = /^(?:[^"'>]|"[^"]*"|'[^']*')*>/.exec(node.raw)?.[0].length ?? 0;
      const location = positions.range(start, start + Math.max(0, tagEnd - 1));
      if (name === "include" || (xml && name === "directive.include")) {
        const kind = name === "include" ? "request" : "translation";
        const value = node.attributes[kind === "request" ? "page" : "file"];
        include(value !== undefined && xml ? decodeXml(value, 0).code : value, kind, location);
      }
      if (xml && (name === "directive.page" || name === "directive.tag")) {
        imports(node.raw.slice(0, tagEnd), start, true);
      }
      if (xml && XML_SCRIPTLET.test(name) && !node.incomplete && !node.selfClosing) {
        const bodyOffset = start + tagEnd;
        const body = node.raw.slice(tagEnd, node.raw.lastIndexOf("</"));
        const decoded = decodeXml(body, bodyOffset);
        result.scriptlets.push({
          kind: name as JspScriptlet["kind"], ...decoded, codeOffset: bodyOffset
        });
        return;
      }
      if (!JSP_SYNTAX_TAGS.has(name) && !name.startsWith("directive.")) {
        result.diagnostics.push({
          code: "SOURCE_JSP_TAG_CONTEXT", message: `JSP action ${name} may introduce runtime types or scripting variables.`, location
        });
      }
    } else if (node.kind === "CustomTagElement") {
      result.diagnostics.push({
        code: "SOURCE_JSP_TAG_CONTEXT", message: `Resolving ${node.prefix}:${node.name} requires the JSP tag library context.`,
        location: positions.range(start, start + node.prefix.length + node.name.length + 1)
      });
    }
    if ("attributeNodes" in node) for (const attribute of node.attributeNodes ?? []) visit(attribute, namespaces);
    if ("children" in node) for (const child of node.children) visit(child, namespaces);
  }

  visit(document, new Set(["jsp"]));
  result.scriptlets.sort((left, right) => left.codeOffset - right.codeOffset);
  return result;
}

function hasElCall(node: ElAstNode): boolean {
  switch (node.kind) {
    case "FunctionCallExpression": return true;
    case "PropertyAccessExpression": return hasElCall(node.target);
    case "IndexAccessExpression": return hasElCall(node.target) || hasElCall(node.index);
    case "UnaryExpression": return hasElCall(node.argument);
    case "BinaryExpression": return hasElCall(node.left) || hasElCall(node.right);
    case "TernaryExpression": return hasElCall(node.test) || hasElCall(node.consequent) || hasElCall(node.alternate);
    case "GroupedExpression": return hasElCall(node.expression);
    default: return false;
  }
}

/** Preserve source character offsets when XML escaping changes the Java text. */
function decodeXml(raw: string, baseOffset: number): { code: string; originOffsets: number[] } {
  const originOffsets: number[] = [];
  let code = "";
  let cursor = 0;
  function appendRaw(start: number, end: number): void {
    code += raw.slice(start, end);
    for (let offset = start; offset < end; offset += 1) originOffsets.push(baseOffset + offset);
  }
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  for (const match of raw.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g)) {
    appendRaw(cursor, match.index);
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) appendRaw(match.index + 9, cursor - 3);
    else if (match[2] !== undefined) {
      const entity = match[2];
      const scalar = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      const decoded = entities[entity] ?? (scalar >= 0 && scalar <= 0x10ffff ? String.fromCodePoint(scalar) : undefined);
      if (decoded === undefined) appendRaw(match.index, cursor);
      else {
        code += decoded;
        for (let index = 0; index < decoded.length; index += 1) originOffsets.push(baseOffset + match.index);
      }
    }
  }
  appendRaw(cursor, raw.length);
  return { code, originOffsets };
}

function sourcePositions(text: string, newline = /\r\n|[\r\n]/g) {
  const starts = [0];
  for (const match of text.matchAll(newline)) starts.push(match.index + match[0].length);
  function position(offset: number): { line: number; column: number } {
    let lower = 0;
    let upper = starts.length;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (starts[middle] <= offset) lower = middle;
      else upper = middle;
    }
    return { line: lower + 1, column: offset - starts[lower] + 1 };
  }
  return {
    offset: (line: number, column: number) => starts[line - 1] + column - 1,
    range(start: number, end: number): SyntaxLocation {
      const first = position(start);
      const last = position(end);
      return { ...first, endLine: last.line, endColumn: last.column };
    }
  };
}

export function buildJspJava(parts: readonly JspJavaPart[], imports: readonly SyntaxImport[]) {
  const distinctImports = new Set(imports.filter((item) => !item.static).map((item) => `${item.name}${item.wildcard ? ".*" : ""}`));
  let text = [...distinctImports].map((name) => `import ${name};\n`).join("") + "class LeflectJspTranslation {\n";
  const segments: { start: number; end: number; partIndex: number }[] = [];
  function append(part: JspJavaPart, partIndex: number): void {
    if (part.scriptlet.kind === "expression") text += "out.print(\n";
    const start = text.length;
    text += part.scriptlet.code;
    segments.push({ start, end: text.length, partIndex });
    text += part.scriptlet.kind === "expression" ? "\n);\n" : "\n";
  }
  parts.forEach((part, partIndex) => { if (part.scriptlet.kind === "declaration") append(part, partIndex); });
  text += "void _jspService() {\n";
  parts.forEach((part, partIndex) => { if (part.scriptlet.kind !== "declaration") append(part, partIndex); });
  text += "}\n}\n";

  const generatedPositions = sourcePositions(text);
  const originalPositions = new Map<string, ReturnType<typeof sourcePositions>>();
  function mapLocation(location: SyntaxLocation): { partIndex: number; location: SyntaxLocation } | undefined {
    const start = generatedPositions.offset(location.line, location.column);
    const segment = segments.find((item) => start >= item.start && start < item.end);
    if (!segment) return undefined;
    const end = Math.min(segment.end - 1, generatedPositions.offset(location.endLine, location.endColumn));
    const part = parts[segment.partIndex];
    const { codeOffset, originOffsets } = part.scriptlet;
    let original = originalPositions.get(part.text);
    if (!original) {
      original = sourcePositions(part.text);
      originalPositions.set(part.text, original);
    }
    const startOffset = originOffsets?.[start - segment.start] ?? (codeOffset + start - segment.start);
    const endOffset = originOffsets?.[end - segment.start] ?? (codeOffset + end - segment.start);
    return { partIndex: segment.partIndex, location: original.range(startOffset, endOffset) };
  }

  return { text, mapLocation };
}

type PlatformTypeAccess = "public" | "nonpublic" | "missing";
type WorkerRequest = { source: string } | { platformType: string } | { platformTypeAccess: string } |
  { platformMemberTypes: { owner: string; member: string } };
type WorkerResponse = {
  id: number;
  syntax?: Omit<JavaSyntax, "imports"> & { imports: (Omit<SyntaxImport, "static"> & { isStatic: boolean })[] };
  platformType?: boolean;
  platformTypeAccess?: PlatformTypeAccess;
  platformMemberTypes?: string[];
  error?: string;
};

export type SourceSyntaxReader = {
  java(text: string): Promise<JavaSyntax>;
  jsp(parts: readonly JspJavaPart[], imports: readonly SyntaxImport[]): Promise<JspJavaSyntax>;
  isPlatformType(className: string): Promise<boolean>;
  platformTypeAccess(className: string): Promise<PlatformTypeAccess>;
  platformMemberTypes(owner: string, member: string): Promise<string[] | undefined>;
  close(): Promise<void>;
};

export function createSourceSyntaxReader(
  config: Pick<LeflectConfig, "java">,
  { signal }: { signal?: AbortSignal } = {}
): SourceSyntaxReader {
  const pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();
  let process: Promise<ChildProcessWithoutNullStreams> | undefined;
  let completed: Promise<void> | undefined;
  let closed = false;
  let id = 0;

  function fail(error: Error): void {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  async function start(): Promise<ChildProcessWithoutNullStreams> {
    const jarPath = await resolveJavaWorkerJar(config.java?.workerJar);
    if (!jarPath) throw new Error("Java worker JAR could not be resolved for source lookup");
    signal?.throwIfAborted();
    if (closed) throw new Error("Source syntax reader is closed");
    const { command, args } = buildJavaCommand({ jarPath, args: ["source-syntax"], ...config.java });
    const child = spawn(command, args, { stdio: "pipe", signal, windowsHide: true });
    const input = createInterface({ input: child.stdout });
    input.on("line", (line) => {
      let response: WorkerResponse;
      try {
        response = JSON.parse(line) as WorkerResponse;
      } catch {
        fail(new Error("Java worker returned invalid source syntax data"));
        child.kill();
        return;
      }
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (response.error) request?.reject(new Error(response.error));
      else request?.resolve(response);
    });
    child.stderr.resume();
    child.stdin.on("error", fail);
    child.on("error", fail);
    completed = new Promise((resolve) => child.once("close", (code) => {
      closed = true;
      fail(new Error(`Source syntax worker stopped (${code ?? "terminated"})`));
      input.close();
      resolve();
    }));
    return child;
  }

  async function send(request: WorkerRequest): Promise<WorkerResponse> {
    signal?.throwIfAborted();
    if (closed) throw new Error("Source syntax reader is closed");
    process ??= start();
    const child = await process;
    signal?.throwIfAborted();
    if (closed) throw new Error("Source syntax reader is closed");
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      child.stdin.write(JSON.stringify({ ...request, id: requestId }) + "\n", (error) => {
        if (!error) return;
        pending.delete(requestId);
        reject(error);
      });
    });
  }

  async function java(text: string): Promise<JavaSyntax> {
    const { syntax } = await send({ source: text });
    if (!syntax) throw new Error("Java worker did not return source syntax data");
    return {
      ...syntax,
      imports: syntax.imports.map(({ isStatic, ...item }) => ({ ...item, static: isStatic })),
      declarations: syntax.declarations.map((declaration) => ({ ...declaration, superTypes: declaration.superTypes ?? [] })),
      types: syntax.types.map((type) => ({ ...type, enclosingTypes: type.enclosingTypes ?? [], resolvedName: type.resolvedName ?? undefined })),
      diagnostics: syntax.diagnostics.map((item) => ({ ...item, location: item.location ?? undefined }))
    };
  }

  return {
    java,
    async jsp(parts, imports) {
      if (!parts.length) return { types: [], diagnostics: [] };
      const input = buildJspJava(parts, imports);
      const syntax = await java(input.text);
      const inheritedScopes = new Set(syntax.declarations.filter(({ superTypes }) => superTypes.length)
        .map(({ className }) => className));
      return {
        types: syntax.types.flatMap((type) => {
          const origin = input.mapLocation(type.location);
          const inheritanceUncertain = type.inheritanceUncertain || type.enclosingTypes.some((name) => inheritedScopes.has(name));
          return origin ? [{ ...type, ...origin, inheritanceUncertain }] : [];
        }),
        diagnostics: syntax.diagnostics.map(({ location, ...item }) => ({
          ...item,
          ...(location && input.mapLocation(location))
        }))
      };
    },
    async isPlatformType(className) {
      const { platformType } = await send({ platformType: className });
      if (typeof platformType !== "boolean") throw new Error("Java worker did not return platform type evidence");
      return platformType;
    },
    async platformTypeAccess(className) {
      const { platformTypeAccess } = await send({ platformTypeAccess: className });
      if (!platformTypeAccess) throw new Error("Java worker did not return platform type access evidence");
      return platformTypeAccess;
    },
    async platformMemberTypes(owner, member) {
      const { platformMemberTypes } = await send({ platformMemberTypes: { owner, member } });
      return platformMemberTypes;
    },
    async close() {
      closed = true;
      const child = await process?.catch(() => undefined);
      child?.stdin.end();
      await completed;
    }
  };
}
