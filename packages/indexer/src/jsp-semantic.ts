import { JspCustomTagElementNode, JspDeclarationNode, JspDocumentNode, JspDocumentRoot, JspExpressionNode, JspHtmlElementNode, JspIncludeDirectiveNode, JspScriptletNode, parseEl } from "@leflect-java/parser-jsp";
import {
  ElAstNode,
  JspCustomTagNode,
  JspIfStatementNode,
  JspLoopNode,
  JspQueryNode,
  JspResolverTagNode,
  JspSemanticAst,
  JspSemanticDiagnostic,
  JspSemanticNode,
  JspSemanticRootNode,
  JspSemanticSummary,
  JspTaglibResolver,
  LineRange,
  TldRegistryEntry
} from "@leflect-java/schema";

import { writeSourceMetadataTree } from "./file-tree";
import { JspDocIndexEntry, JspFileMetadata } from "./jsp-index";

const SCHEMA_VERSION = "1.0";
const JSTL_CORE_URIS = new Set([
  "http://java.sun.com/jsp/jstl/core",
  "http://xmlns.jcp.org/jsp/jstl/core",
  "jakarta.tags.core"
]);
const JSTL_SQL_URIS = new Set([
  "http://java.sun.com/jsp/jstl/sql",
  "http://xmlns.jcp.org/jsp/jstl/sql",
  "jakarta.tags.sql"
]);

export type BuildJspSemanticAstsOptions = {
  projectRoot: string;
  analysisOut: string;
  astMode: "lightweight" | "jasper";
  docs: JspDocIndexEntry[];
  files?: JspFileMetadata[];
  registry: TldRegistryEntry[];
  taglibResolvers?: Record<string, JspTaglibResolver>;
};

export async function buildJspSemanticAsts(
  options: BuildJspSemanticAstsOptions
): Promise<JspSemanticAst[]> {
  const metadataByFile = new Map((options.files ?? []).map((file) => [file.path, file]));
  const registryByUri = new Map(
    options.registry
      .filter((entry): entry is TldRegistryEntry & { uri: string } => Boolean(entry.uri))
      .map((entry) => [entry.uri, entry])
  );

  const asts: JspSemanticAst[] = [];

  for (const doc of options.docs) {
    const diagnostics: JspSemanticDiagnostic[] = [];
    const fileMetadata = metadataByFile.get(doc.path);
    const document = doc.document ?? createEmptyDocument();
    if (!doc.document) {
      diagnostics.push({
        severity: "warning",
        code: "missing-document",
        message: `JSP structural document is missing for ${doc.path}`
      });
    }

    const root = await transformRootNode(
      document,
      {
        doc,
        registryByUri,
        fileMetadata,
        taglibResolvers: options.taglibResolvers ?? {},
        projectRoot: options.projectRoot,
        analysisOut: options.analysisOut,
        diagnostics
      }
    );
    const semanticSummary = summarizeSemanticAst(root, diagnostics);

    asts.push({
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      path: doc.path,
      astMode: options.astMode,
      semanticSummary,
      root,
      diagnostics
    });
  }

  return asts.sort((left, right) => left.path.localeCompare(right.path));
}

export async function writeJspSemanticAsts(
  rootDir: string,
  asts: JspSemanticAst[]
): Promise<Map<string, string>> {
  return writeSourceMetadataTree(rootDir, asts);
}

type TransformContext = {
  doc: JspDocIndexEntry;
  registryByUri: Map<string, TldRegistryEntry>;
  fileMetadata?: JspFileMetadata;
  taglibResolvers: Record<string, JspTaglibResolver>;
  projectRoot: string;
  analysisOut: string;
  diagnostics: JspSemanticDiagnostic[];
};

async function transformRootNode(
  document: JspDocumentRoot,
  ctx: TransformContext
): Promise<JspSemanticRootNode> {
  const children = await transformChildren(document.children, ctx);
  return {
    kind: "Document",
    raw: document.raw,
    lineRange: document.lineRange,
    children
  };
}

async function transformChildren(
  children: JspDocumentNode[],
  ctx: TransformContext
): Promise<JspSemanticNode[]> {
  const transformed: JspSemanticNode[] = [];

  for (const child of children) {
    transformed.push(...(await transformNode(child, ctx)));
  }

  return transformed;
}

async function transformNode(
  node: JspDocumentNode,
  ctx: TransformContext
): Promise<JspSemanticNode[]> {
  switch (node.kind) {
    case "Document":
      return [await transformRootNode(node, ctx)];
    case "Text":
      return [{
        kind: "TextNode",
        raw: node.raw,
        text: node.text,
        lineRange: node.lineRange
      }];
    case "ElExpression":
      return [{
        kind: "ElExpressionNode",
        raw: node.raw,
        expression: node.expression,
        ast: node.ast,
        lineRange: node.lineRange
      }];
    case "HtmlElement":
      return [{
        kind: "HtmlElementNode",
        raw: node.raw,
        tagName: node.tagName,
        attributes: node.attributes,
        lineRange: node.lineRange,
        children: await transformChildren(node.children, ctx)
      }];
    case "IncludeDirective":
      return [buildIncludeNode(node)];
    case "Scriptlet":
    case "Expression":
    case "Declaration":
      return [buildScriptletNode(node, ctx.fileMetadata)];
    case "Directive":
      return [];
    case "CustomTagElement":
      return resolveCustomTagNode(node, ctx);
    default:
      return [];
  }
}

async function resolveCustomTagNode(
  node: JspCustomTagElementNode,
  ctx: TransformContext
): Promise<JspSemanticNode[]> {
  const children = await transformChildren(node.children, ctx);
  const resolved = resolveTagMetadata(node, ctx.doc, ctx.registryByUri);
  const tag: JspResolverTagNode = {
    prefix: node.prefix,
    name: node.name,
    uri: resolved.uri,
    handlerClass: resolved.handlerClass,
    raw: node.raw,
    attributes: node.attributes,
    attributeExpressions: Object.fromEntries(
      Object.entries(node.attributes).map(([key, value]) => [key, looksLikeEl(value) ? parseElValue(value) : undefined])
    ),
    lineRange: node.lineRange,
    bodyText: collectBodyText(children),
    children
  };

  const resolver = resolveUserTagResolver(ctx.taglibResolvers, tag);
  if (resolver) {
    try {
      const result = await resolver({
        projectRoot: ctx.projectRoot,
        analysisOut: ctx.analysisOut,
        filePath: ctx.doc.path,
        tag,
        tld: resolved.tld,
        parseEl: parseElValue
      });
      if (result) {
        return normalizeSemanticResolverResult(result, children, tag);
      }
    } catch (error) {
      ctx.diagnostics.push({
        severity: "warning",
        code: "resolver-error",
        message: `Custom tag resolver failed for ${tag.prefix}:${tag.name}`,
        detail: error instanceof Error ? error.message : String(error),
        lineRange: tag.lineRange,
        sourceTag: `${tag.prefix}:${tag.name}`
      });
    }
  }

  const builtIn = buildBuiltInSemanticNode(tag);
  if (builtIn) {
    return normalizeSemanticResolverResult(builtIn, children, tag);
  }

  return [{
    kind: "CustomTagNode",
    raw: node.raw,
    lineRange: node.lineRange,
    sourceTag: tag,
    uri: resolved.uri,
    handlerClass: resolved.handlerClass,
    attributes: node.attributes,
    children
  }];
}

function buildBuiltInSemanticNode(tag: JspResolverTagNode): JspSemanticNode | undefined {
  if (isCoreTag(tag, "if")) {
    const result: JspIfStatementNode = {
      kind: "IfStatement",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      condition: resolveAttributeExpression(tag, "test"),
      children: tag.children
    };
    return result;
  }

  if (isCoreTag(tag, "choose")) {
    return {
      kind: "ChooseStatement",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      children: tag.children
    };
  }

  if (isCoreTag(tag, "when")) {
    return {
      kind: "WhenBranch",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      condition: resolveAttributeExpression(tag, "test"),
      children: tag.children
    };
  }

  if (isCoreTag(tag, "otherwise")) {
    return {
      kind: "OtherwiseBranch",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      children: tag.children
    };
  }

  if (isCoreTag(tag, "forEach")) {
    const loopNode: JspLoopNode = {
      kind: "LoopNode",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      item: tag.attributes["var"],
      collection: resolveAttributeExpression(tag, "items"),
      begin: resolveAttributeExpression(tag, "begin"),
      end: resolveAttributeExpression(tag, "end"),
      step: resolveAttributeExpression(tag, "step"),
      children: tag.children
    };
    return loopNode;
  }

  if (isSqlTag(tag, "query") || isSqlTag(tag, "update")) {
    const queryNode: JspQueryNode = {
      kind: "QueryNode",
      raw: tag.raw,
      lineRange: tag.lineRange,
      sourceTag: tag,
      queryId: tag.attributes["id"] ?? tag.attributes["var"],
      statement: tag.bodyText?.trim() || undefined,
      parameters: undefined,
      dataSource: tag.attributes["dataSource"],
      children: tag.children
    };
    return queryNode;
  }

  return undefined;
}

function normalizeSemanticResolverResult(
  result: JspSemanticNode | JspSemanticNode[],
  children: JspSemanticNode[],
  tag: JspResolverTagNode
): JspSemanticNode[] {
  const entries = Array.isArray(result) ? result : [result];
  return entries.map((entry) => ({
    ...entry,
    children: entry.children ?? children,
    raw: entry.raw ?? tag.raw,
    lineRange: entry.lineRange ?? tag.lineRange
  }));
}

function buildScriptletNode(
  node: JspScriptletNode | JspExpressionNode | JspDeclarationNode,
  fileMetadata?: JspFileMetadata
): JspSemanticNode {
  const summary = summarizeScriptlet(node, fileMetadata);
  const kind = node.kind === "Scriptlet"
    ? "ScriptletNode"
    : node.kind === "Expression"
      ? "ExpressionNode"
      : "DeclarationNode";

  return {
    kind,
    raw: node.raw,
    lineRange: node.lineRange,
    code: node.code,
    classReferences: summary.classReferences,
    methodCalls: summary.methodCalls
  };
}

function summarizeScriptlet(
  node: JspScriptletNode | JspExpressionNode | JspDeclarationNode,
  fileMetadata?: JspFileMetadata
): {
  classReferences: Array<{ className: string; classPath?: string }>;
  methodCalls: Array<{ methodName: string; methodId?: string; classPath?: string; qualifier?: string }>;
} {
  if (!fileMetadata) {
    return { classReferences: [], methodCalls: [] };
  }

  const classReferences = fileMetadata.classReferences
    .filter((reference) => isLocationInside(reference.location, node.lineRange))
    .map((reference) => ({
      className: reference.className,
      classPath: reference.classPath
    }));
  const methodCalls = fileMetadata.methodCalls
    .filter((call) => isLocationInside(call.location, node.lineRange))
    .map((call) => ({
      methodName: call.methodName,
      methodId: call.methodId,
      classPath: call.classPath,
      qualifier: call.qualifier
    }));

  return { classReferences, methodCalls };
}

function buildIncludeNode(node: JspIncludeDirectiveNode): JspSemanticNode {
  return {
    kind: "IncludeReference",
    raw: node.raw,
    lineRange: node.lineRange,
    target: node.target ?? ""
  };
}

function resolveTagMetadata(
  node: JspCustomTagElementNode,
  doc: JspDocIndexEntry,
  registryByUri: Map<string, TldRegistryEntry>
): { uri?: string; handlerClass?: string; tld?: TldRegistryEntry } {
  const resolved = doc.resolvedTags?.find((entry) => entry.prefix === node.prefix && entry.name === node.name);
  const explicitUri = doc.taglibs.find((taglib) => taglib.prefix === node.prefix)?.uri;
  const uri = resolved?.uri ?? explicitUri ?? inferStandardUri(node.prefix);
  const tld = uri ? registryByUri.get(uri) : undefined;
  const handlerClass = resolved?.handlerClass ?? tld?.tags.find((tag) => tag.name === node.name)?.handlerClass;

  return { uri, handlerClass, tld };
}

function resolveUserTagResolver(
  resolvers: Record<string, JspTaglibResolver>,
  tag: JspResolverTagNode
): JspTaglibResolver | undefined {
  if (tag.uri) {
    const byUri = resolvers[`${tag.uri}#${tag.name}`];
    if (byUri) {
      return byUri;
    }
  }
  return resolvers[`${tag.prefix}:${tag.name}`];
}

function collectBodyText(children: JspSemanticNode[]): string {
  return children
    .map((child) => {
      if (child.kind === "TextNode") {
        return child.text;
      }
      if (child.kind === "ElExpressionNode") {
        return child.expression;
      }
      return child.raw;
    })
    .join("")
    .trim();
}

function summarizeSemanticAst(
  root: JspSemanticRootNode,
  diagnostics: JspSemanticDiagnostic[]
): JspSemanticSummary {
  let nodeCount = 0;
  let controlCount = 0;
  let queryCount = 0;
  let customTagCount = 0;

  const visit = (node: JspSemanticNode) => {
    nodeCount += 1;
    if (["IfStatement", "ChooseStatement", "WhenBranch", "OtherwiseBranch", "LoopNode"].includes(node.kind)) {
      controlCount += 1;
    }
    if (node.kind === "QueryNode") {
      queryCount += 1;
    }
    if (node.kind === "CustomTagNode") {
      customTagCount += 1;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(root);

  return {
    nodeCount,
    controlCount,
    queryCount,
    customTagCount,
    diagnosticCount: diagnostics.length
  };
}

function isLocationInside(
  location: { line?: number; column?: number; endLine?: number; endColumn?: number } | undefined,
  lineRange: LineRange
): boolean {
  if (!location?.line || !location?.endLine) {
    return false;
  }

  if (location.line < lineRange.startLine || location.endLine > lineRange.endLine) {
    return false;
  }

  if (location.line === lineRange.startLine && (location.column ?? 0) < lineRange.startColumn) {
    return false;
  }

  if (location.endLine === lineRange.endLine && (location.endColumn ?? 0) > lineRange.endColumn) {
    return false;
  }

  return true;
}

function parseElValue(value: string): ElAstNode {
  return parseEl(value);
}

function resolveAttributeExpression(tag: JspResolverTagNode, name: string): ElAstNode | undefined {
  return tag.attributeExpressions[name] ?? (tag.attributes[name] ? parseElValue(tag.attributes[name]) : undefined);
}

function looksLikeEl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("${") || trimmed.startsWith("#{");
}

function isCoreTag(tag: JspResolverTagNode, tagName: string): boolean {
  return tag.name === tagName && (JSTL_CORE_URIS.has(tag.uri ?? "") || (!tag.uri && tag.prefix === "c"));
}

function isSqlTag(tag: JspResolverTagNode, tagName: string): boolean {
  return tag.name === tagName && (JSTL_SQL_URIS.has(tag.uri ?? "") || (!tag.uri && tag.prefix === "sql"));
}

function inferStandardUri(prefix: string): string | undefined {
  if (prefix === "c") {
    return "http://java.sun.com/jsp/jstl/core";
  }
  if (prefix === "sql") {
    return "http://java.sun.com/jsp/jstl/sql";
  }
  return undefined;
}

function createEmptyDocument(): JspDocumentRoot {
  return {
    kind: "Document",
    raw: "",
    lineRange: {
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1
    },
    children: []
  };
}
