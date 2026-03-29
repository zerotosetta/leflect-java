import fs from "fs/promises";
import path from "path";

import type {
  CallIndexEntry,
  ClassIndexEntry,
  JavaFileMetadata,
  JavaSourceLocation,
  JspClassReferenceIndexEntry,
  JspFileMetadata,
  JspMethodCallIndexEntry,
  JspScriptletIndexEntry,
  JspTagUsageIndexEntry,
  MethodIndexEntry
} from "@leflect-java/indexer";

import type { ProjectionFileEntry, ProjectionSnapshot } from "./projection";

export type ProjectionAstGraphNodeCategory =
  | "root"
  | "declaration"
  | "member"
  | "statement"
  | "expression"
  | "tag"
  | "scriptlet"
  | "binding"
  | "external";

export type ProjectionAstGraphNode = {
  id: string;
  path: string;
  label: string;
  astType: string;
  category: ProjectionAstGraphNodeCategory;
  external: boolean;
  location?: JavaSourceLocation;
  detail?: string;
};

export type ProjectionAstGraphLink = {
  source: string;
  target: string;
  type: "child" | "call" | "reference" | "external";
  external: boolean;
  label?: string;
};

export type ProjectionAstGraphResponse = {
  focusPath: string;
  includeExternal: boolean;
  truncated: boolean;
  stats: {
    nodes: number;
    edges: number;
  };
  nodes: ProjectionAstGraphNode[];
  links: ProjectionAstGraphLink[];
};

const MAX_LOCAL_AST_NODES = 220;
const MAX_EXTERNAL_AST_NODES = 72;
const MAX_EXTERNAL_ATTACHMENTS = 8;
const AST_META_KEYS = new Set(["!", "range", "tokenRange", "comment", "orphanComments", "allContainedComments", "annotations"]);
const JAVA_AST_CATEGORIES = new Map<string, ProjectionAstGraphNodeCategory>([
  ["CompilationUnit", "root"],
  ["PackageDeclaration", "member"],
  ["ImportDeclaration", "member"],
  ["ClassOrInterfaceDeclaration", "declaration"],
  ["EnumDeclaration", "declaration"],
  ["AnnotationDeclaration", "declaration"],
  ["RecordDeclaration", "declaration"],
  ["FieldDeclaration", "member"],
  ["EnumConstantDeclaration", "member"],
  ["ConstructorDeclaration", "member"],
  ["MethodDeclaration", "member"],
  ["InitializerDeclaration", "member"],
  ["Parameter", "member"],
  ["VariableDeclarator", "member"],
  ["IfStmt", "statement"],
  ["ForStmt", "statement"],
  ["ForEachStmt", "statement"],
  ["WhileStmt", "statement"],
  ["DoStmt", "statement"],
  ["SwitchStmt", "statement"],
  ["SwitchEntry", "statement"],
  ["TryStmt", "statement"],
  ["CatchClause", "statement"],
  ["ThrowStmt", "statement"],
  ["ReturnStmt", "statement"],
  ["ExpressionStmt", "statement"],
  ["MethodCallExpr", "expression"],
  ["ObjectCreationExpr", "expression"],
  ["VariableDeclarationExpr", "expression"],
  ["AssignExpr", "expression"],
  ["BinaryExpr", "expression"],
  ["ConditionalExpr", "expression"],
  ["LambdaExpr", "expression"],
  ["MethodReferenceExpr", "expression"],
  ["FieldAccessExpr", "expression"],
  ["CastExpr", "expression"],
  ["InstanceOfExpr", "expression"],
  ["UnaryExpr", "expression"]
]);

type AstGraphBuilder = {
  nodes: ProjectionAstGraphNode[];
  links: ProjectionAstGraphLink[];
  truncated: boolean;
  rootId: string;
  localNodeCount: number;
  externalNodeCount: number;
  nodeIds: Set<string>;
  locationIndex: Map<string, ProjectionAstGraphNode[]>;
  externalRootIds: Map<string, string>;
  nextId(prefix: string): string;
  addNode(node: ProjectionAstGraphNode, options?: { indexLocation?: boolean; external?: boolean }): string | undefined;
  addLink(link: ProjectionAstGraphLink): void;
  findNodeByLocation(location?: JavaSourceLocation, astType?: string): ProjectionAstGraphNode | undefined;
};

export async function loadProjectionAstGraph(
  snapshot: ProjectionSnapshot,
  options: {
    focusPath: string;
    includeExternal?: boolean;
  }
): Promise<ProjectionAstGraphResponse> {
  const focusPath = normalizePath(options.focusPath);
  const file = snapshot.filesByPath.get(focusPath);
  if (!file || (file.nodeType !== "java" && file.nodeType !== "jsp")) {
    return {
      focusPath,
      includeExternal: Boolean(options.includeExternal),
      truncated: false,
      stats: { nodes: 0, edges: 0 },
      nodes: [],
      links: []
    };
  }

  const builder = createAstGraphBuilder(file.path);
  builder.addNode(
    {
      id: builder.rootId,
      path: file.path,
      label: path.basename(file.path),
      astType: file.nodeType === "java" ? "CompilationUnit" : "JspPage",
      category: "root",
      external: false
    },
    { indexLocation: false }
  );

  if (file.nodeType === "java") {
    const metadata = await loadJson<JavaFileMetadata | undefined>(metadataFilePath(snapshot, file), undefined);
    const astJson = await loadJson<unknown>(javaAstFilePath(snapshot, file.path), undefined);
    if (astJson) {
      if (isRecord(astJson) && simplifyAstType(typeof astJson["!"] === "string" ? astJson["!"] : undefined) === "CompilationUnit") {
        for (const [key, child] of Object.entries(astJson)) {
          if (AST_META_KEYS.has(key)) {
            continue;
          }
          walkJavaAst(child, builder, file.path, builder.rootId);
        }
      } else {
        walkJavaAst(astJson, builder, file.path, builder.rootId);
      }
    } else if (metadata) {
      buildJavaMetadataFallback(builder, file.path, metadata);
    }
    if (options.includeExternal && metadata) {
      await attachExternalJavaTargets(builder, snapshot, file, metadata);
    }
  } else {
    const metadata = await loadJson<JspFileMetadata | undefined>(metadataFilePath(snapshot, file), undefined);
    if (metadata) {
      buildJspAstGraph(builder, file.path, metadata);
      if (options.includeExternal) {
        await attachExternalJspTargets(builder, snapshot, file, metadata);
      }
    }
  }

  return {
    focusPath,
    includeExternal: Boolean(options.includeExternal),
    truncated: builder.truncated,
    stats: {
      nodes: builder.nodes.length,
      edges: builder.links.length
    },
    nodes: builder.nodes,
    links: builder.links
  };
}

function createAstGraphBuilder(rootPath: string): AstGraphBuilder {
  let sequence = 0;
  return {
    nodes: [],
    links: [],
    truncated: false,
    rootId: `ast:root:${rootPath}`,
    localNodeCount: 0,
    externalNodeCount: 0,
    nodeIds: new Set<string>(),
    locationIndex: new Map<string, ProjectionAstGraphNode[]>(),
    externalRootIds: new Map<string, string>(),
    nextId(prefix: string) {
      sequence += 1;
      return `${prefix}:${sequence}`;
    },
    addNode(node, options) {
      const isExternal = options?.external ?? node.external;
      if (this.nodeIds.has(node.id)) {
        return node.id;
      }
      if (isExternal) {
        if (this.externalNodeCount >= MAX_EXTERNAL_AST_NODES) {
          this.truncated = true;
          return undefined;
        }
        this.externalNodeCount += 1;
      } else {
        if (this.localNodeCount >= MAX_LOCAL_AST_NODES) {
          this.truncated = true;
          return undefined;
        }
        this.localNodeCount += 1;
      }
      this.nodeIds.add(node.id);
      this.nodes.push(node);
      if (options?.indexLocation !== false) {
        const locationKey = serializeLocation(node.location);
        if (locationKey) {
          const existing = this.locationIndex.get(locationKey) ?? [];
          existing.push(node);
          this.locationIndex.set(locationKey, existing);
        }
      }
      return node.id;
    },
    addLink(link) {
      if (this.links.some((existing) => existing.source === link.source && existing.target === link.target && existing.type === link.type)) {
        return;
      }
      this.links.push(link);
    },
    findNodeByLocation(location, astType) {
      const locationKey = serializeLocation(location);
      if (!locationKey) {
        return undefined;
      }
      const candidates = this.locationIndex.get(locationKey) ?? [];
      if (!astType) {
        return candidates[0];
      }
      return candidates.find((candidate) => candidate.astType === astType) ?? candidates[0];
    }
  };
}

function walkJavaAst(
  value: unknown,
  builder: AstGraphBuilder,
  filePath: string,
  parentId: string
): void {
  if (builder.truncated) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkJavaAst(entry, builder, filePath, parentId);
      if (builder.truncated) {
        break;
      }
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const rawType = typeof value["!"] === "string" ? value["!"] : undefined;
  const astType = simplifyAstType(rawType);
  const category = astType ? JAVA_AST_CATEGORIES.get(astType) : undefined;
  let nextParentId = parentId;

  if (astType && category) {
    const nodeId = builder.addNode({
      id: builder.nextId("ast"),
      path: filePath,
      label: buildJavaAstLabel(astType, value),
      astType,
      category,
      external: false,
      location: extractLocation(value["range"]),
      detail: buildJavaAstDetail(astType, value)
    });
    if (!nodeId) {
      return;
    }
    builder.addLink({
      source: parentId,
      target: nodeId,
      type: "child",
      external: false
    });
    nextParentId = nodeId;
  }

  for (const [key, child] of Object.entries(value)) {
    if (AST_META_KEYS.has(key)) {
      continue;
    }
    walkJavaAst(child, builder, filePath, nextParentId);
    if (builder.truncated) {
      break;
    }
  }
}

function buildJavaMetadataFallback(builder: AstGraphBuilder, filePath: string, metadata: JavaFileMetadata): void {
  const classNodeIds = new Map<string, string>();
  for (const classEntry of metadata.classes) {
    const nodeId = builder.addNode({
      id: builder.nextId("ast"),
      path: filePath,
      label: classEntry.name,
      astType: classEntry.kind === "interface" ? "InterfaceDeclaration" : "ClassOrInterfaceDeclaration",
      category: "declaration",
      external: false,
      location: classEntry.location,
      detail: classEntry.id
    });
    if (!nodeId) {
      return;
    }
    builder.addLink({ source: builder.rootId, target: nodeId, type: "child", external: false });
    classNodeIds.set(classEntry.id, nodeId);
  }

  const methodNodeIds = new Map<string, string>();
  for (const method of metadata.methods) {
    const parentId = method.classId ? classNodeIds.get(method.classId) ?? builder.rootId : builder.rootId;
    const nodeId = builder.addNode({
      id: builder.nextId("ast"),
      path: filePath,
      label: buildMethodLabel(method),
      astType: "MethodDeclaration",
      category: "member",
      external: false,
      location: method.location,
      detail: method.id
    });
    if (!nodeId) {
      return;
    }
    builder.addLink({ source: parentId, target: nodeId, type: "child", external: false });
    methodNodeIds.set(method.id, nodeId);
  }

  for (const call of metadata.calls) {
    const parentId = call.fromMethodId ? methodNodeIds.get(call.fromMethodId) ?? builder.rootId : builder.rootId;
    const nodeId = builder.addNode({
      id: builder.nextId("ast"),
      path: filePath,
      label: call.methodName ? `${call.methodName}()` : simplifySymbol(call.toMethodId ?? call.toClassId ?? call.to ?? "call"),
      astType: "MethodCallExpr",
      category: "expression",
      external: false,
      location: call.location,
      detail: call.toMethodId ?? call.toClassId ?? call.classPath ?? call.to
    });
    if (!nodeId) {
      return;
    }
    builder.addLink({ source: parentId, target: nodeId, type: "child", external: false });
  }
}

function buildJspAstGraph(builder: AstGraphBuilder, filePath: string, metadata: JspFileMetadata): void {
  const groupIds = new Map<string, string>();
  const ensureGroup = (key: string, label: string, category: ProjectionAstGraphNodeCategory) => {
    const existing = groupIds.get(key);
    if (existing) {
      return existing;
    }
    const nodeId = builder.addNode({
      id: builder.nextId("jsp"),
      path: filePath,
      label,
      astType: label,
      category,
      external: false
    });
    if (!nodeId) {
      return builder.rootId;
    }
    builder.addLink({ source: builder.rootId, target: nodeId, type: "child", external: false });
    groupIds.set(key, nodeId);
    return nodeId;
  };

  const scriptletGroupId = metadata.scriptlets.length > 0 ? ensureGroup("scriptlets", "scriptlets", "scriptlet") : undefined;
  const tagGroupId = metadata.tags.length > 0 ? ensureGroup("tags", "tags", "tag") : undefined;
  const bindingGroupId = metadata.methodCalls.length > 0 || metadata.classReferences.length > 0
    ? ensureGroup("bindings", "bindings", "binding")
    : undefined;

  const scriptletNodes = metadata.scriptlets.map((scriptlet) =>
    addJspLeafNode(builder, {
      parentId: scriptletGroupId ?? builder.rootId,
      filePath,
      label: `${scriptlet.kind} ${scriptlet.location?.line ?? "?"}`,
      astType: "JspScriptlet",
      category: "scriptlet",
      location: scriptlet.location,
      detail: compactSnippet(scriptlet.code)
    })
  );

  metadata.tags.forEach((tag, index) => {
    addJspLeafNode(builder, {
      parentId: tagGroupId ?? builder.rootId,
      filePath,
      label: `${tag.prefix}:${tag.name}`,
      astType: "JspTag",
      category: "tag",
      location: tag.location,
      detail: `${tag.raw}${tag.handlerClass ? ` -> ${tag.handlerClass}` : ""}`
    }, index);
  });

  metadata.methodCalls.forEach((call, index) => {
    const parentId = findContainingScriptletParent(builder, call.location, scriptletNodes) ?? bindingGroupId ?? builder.rootId;
    addJspLeafNode(builder, {
      parentId,
      filePath,
      label: buildJspMethodCallLabel(call),
      astType: "JspMethodCall",
      category: "binding",
      location: call.location,
      detail: call.classPath ?? call.methodId ?? call.snippet
    }, index);
  });

  metadata.classReferences.forEach((reference, index) => {
    addJspLeafNode(builder, {
      parentId: bindingGroupId ?? builder.rootId,
      filePath,
      label: simplifySymbol(reference.classPath ?? reference.className),
      astType: "JspClassReference",
      category: "binding",
      location: reference.location,
      detail: reference.classPath ?? reference.className
    }, index);
  });
}

async function attachExternalJavaTargets(
  builder: AstGraphBuilder,
  snapshot: ProjectionSnapshot,
  file: ProjectionFileEntry,
  metadata: JavaFileMetadata
): Promise<void> {
  const attached = new Set<string>();
  for (const call of metadata.calls) {
    if (attached.size >= MAX_EXTERNAL_ATTACHMENTS || builder.truncated) {
      builder.truncated = true;
      break;
    }
    const symbol = call.toMethodId ?? call.toClassId ?? call.classPath ?? call.to;
    const targetPath = call.toFile && snapshot.filesByPath.has(normalizePath(call.toFile))
      ? normalizePath(call.toFile)
      : resolveReferenceTargetPath(snapshot, file, [
          call.toMethodId,
          call.toClassId,
          call.classPath,
          call.to
        ]);
    if (!targetPath || targetPath === file.path || attached.has(`${targetPath}:${symbol ?? ""}`)) {
      continue;
    }
    const anchor = builder.findNodeByLocation(call.location, "MethodCallExpr") ?? builder.findNodeByLocation(call.location) ?? builder.nodes[0];
    if (!anchor) {
      continue;
    }
    const externalNodeId = await ensureExternalTargetNode(builder, snapshot, targetPath, symbol);
    if (!externalNodeId) {
      continue;
    }
    builder.addLink({
      source: anchor.id,
      target: externalNodeId,
      type: "external",
      external: true,
      label: call.methodName
    });
    attached.add(`${targetPath}:${symbol ?? ""}`);
  }
}

async function attachExternalJspTargets(
  builder: AstGraphBuilder,
  snapshot: ProjectionSnapshot,
  file: ProjectionFileEntry,
  metadata: JspFileMetadata
): Promise<void> {
  const attached = new Set<string>();
  const tryAttach = async (
    location: JavaSourceLocation | undefined,
    candidates: Array<string | undefined>,
    label?: string,
    preferredAstType?: string
  ) => {
    if (attached.size >= MAX_EXTERNAL_ATTACHMENTS || builder.truncated) {
      builder.truncated = true;
      return;
    }
    const symbol = candidates.find(Boolean);
    const targetPath = resolveReferenceTargetPath(snapshot, file, candidates);
    if (!targetPath || targetPath === file.path || attached.has(`${targetPath}:${symbol ?? ""}`)) {
      return;
    }
    const anchor = builder.findNodeByLocation(location, preferredAstType) ?? builder.findNodeByLocation(location) ?? builder.nodes[0];
    if (!anchor) {
      return;
    }
    const externalNodeId = await ensureExternalTargetNode(builder, snapshot, targetPath, symbol);
    if (!externalNodeId) {
      return;
    }
    builder.addLink({
      source: anchor.id,
      target: externalNodeId,
      type: "external",
      external: true,
      label
    });
    attached.add(`${targetPath}:${symbol ?? ""}`);
  };

  for (const call of metadata.methodCalls) {
    await tryAttach(call.location, [call.methodId, call.classPath], call.methodName, "JspMethodCall");
  }
  for (const reference of metadata.classReferences) {
    await tryAttach(reference.location, [reference.classPath, reference.className], reference.className, "JspClassReference");
  }
  for (const tag of metadata.tags) {
    if (!tag.handlerClass) {
      continue;
    }
    await tryAttach(tag.location, [tag.handlerClass], `${tag.prefix}:${tag.name}`, "JspTag");
  }
}

async function ensureExternalTargetNode(
  builder: AstGraphBuilder,
  snapshot: ProjectionSnapshot,
  targetPath: string,
  symbol?: string
): Promise<string | undefined> {
  const normalizedTarget = normalizePath(targetPath);
  const targetFile = snapshot.filesByPath.get(normalizedTarget);
  if (!targetFile || (targetFile.nodeType !== "java" && targetFile.nodeType !== "jsp")) {
    return undefined;
  }

  const rootId = builder.externalRootIds.get(normalizedTarget) ?? builder.addNode({
    id: builder.nextId("ext-root"),
    path: normalizedTarget,
    label: path.basename(normalizedTarget),
    astType: targetFile.nodeType === "java" ? "ExternalCompilationUnit" : "ExternalJspPage",
    category: "external",
    external: true
  }, { external: true, indexLocation: false });
  if (!rootId) {
    return undefined;
  }
  builder.externalRootIds.set(normalizedTarget, rootId);

  if (!symbol) {
    return rootId;
  }

  if (targetFile.nodeType === "java") {
    const metadata = await loadJson<JavaFileMetadata | undefined>(metadataFilePath(snapshot, targetFile), undefined);
    if (!metadata) {
      return rootId;
    }
    const classEntry = resolveExternalJavaClass(metadata, symbol);
    const classNodeId = classEntry
      ? ensureExternalDeclarationNode(builder, normalizedTarget, rootId, classEntry.name, "ExternalClassDeclaration", classEntry.location, classEntry.id)
      : rootId;
    if (symbol.includes("#")) {
      const methodEntry = metadata.methods.find((entry) => entry.id === symbol);
      if (methodEntry) {
        return ensureExternalDeclarationNode(
          builder,
          normalizedTarget,
          classNodeId ?? rootId,
          buildMethodLabel(methodEntry),
          "ExternalMethodDeclaration",
          methodEntry.location,
          methodEntry.id
        ) ?? classNodeId ?? rootId;
      }
    }
    return classNodeId ?? rootId;
  }

  return rootId;
}

function ensureExternalDeclarationNode(
  builder: AstGraphBuilder,
  targetPath: string,
  parentId: string,
  label: string,
  astType: string,
  location?: JavaSourceLocation,
  detail?: string
): string | undefined {
  const existing = builder.nodes.find((node) => node.path === targetPath && node.astType === astType && node.detail === detail);
  if (existing) {
    return existing.id;
  }
  const nodeId = builder.addNode({
    id: builder.nextId("ext"),
    path: targetPath,
    label,
    astType,
    category: "external",
    external: true,
    location,
    detail
  }, { external: true });
  if (!nodeId) {
    return undefined;
  }
  builder.addLink({
    source: parentId,
    target: nodeId,
    type: "child",
    external: true
  });
  return nodeId;
}

function resolveExternalJavaClass(metadata: JavaFileMetadata, symbol: string): ClassIndexEntry | undefined {
  const classId = symbol.includes("#") ? symbol.split("#")[0] : symbol;
  return metadata.classes.find((entry) => entry.id === classId) ?? metadata.classes[0];
}

function addJspLeafNode(
  builder: AstGraphBuilder,
  options: {
    parentId: string;
    filePath: string;
    label: string;
    astType: string;
    category: ProjectionAstGraphNodeCategory;
    location?: JavaSourceLocation;
    detail?: string;
  },
  index = 0
): string | undefined {
  const nodeId = builder.addNode({
    id: builder.nextId(`jsp-${index}`),
    path: options.filePath,
    label: options.label,
    astType: options.astType,
    category: options.category,
    external: false,
    location: options.location,
    detail: options.detail
  });
  if (!nodeId) {
    return undefined;
  }
  builder.addLink({
    source: options.parentId,
    target: nodeId,
    type: "child",
    external: false
  });
  return nodeId;
}

function findContainingScriptletParent(
  builder: AstGraphBuilder,
  location: JavaSourceLocation | undefined,
  scriptletNodeIds: Array<string | undefined>
): string | undefined {
  if (!location) {
    return undefined;
  }
  for (const nodeId of scriptletNodeIds) {
    if (!nodeId) {
      continue;
    }
    const node = builder.nodes.find((entry) => entry.id === nodeId);
    if (node?.location && containsLocation(node.location, location)) {
      return node.id;
    }
  }
  return undefined;
}

function buildJavaAstLabel(astType: string, payload: Record<string, unknown>): string {
  if (astType === "CompilationUnit") {
    return "compilation unit";
  }
  if (astType === "PackageDeclaration" || astType === "ImportDeclaration") {
    return extractQualifiedName(payload["name"]) ?? astType;
  }
  if (astType === "ClassOrInterfaceDeclaration" || astType === "EnumDeclaration" || astType === "AnnotationDeclaration" || astType === "RecordDeclaration") {
    return extractIdentifier(payload["name"]) ?? astType;
  }
  if (astType === "MethodDeclaration" || astType === "ConstructorDeclaration") {
    return `${extractIdentifier(payload["name"]) ?? "method"}(${extractArrayLength(payload["parameters"])})`;
  }
  if (astType === "FieldDeclaration") {
    return extractVariableNames(payload["variables"]) || "field";
  }
  if (astType === "VariableDeclarator" || astType === "Parameter") {
    return extractIdentifier(payload["name"]) ?? astType;
  }
  if (astType === "MethodCallExpr") {
    return `${extractIdentifier(payload["name"]) ?? "call"}()`;
  }
  if (astType === "ObjectCreationExpr") {
    return `new ${extractTypeName(payload["type"]) ?? "type"}()`;
  }
  if (astType === "AssignExpr") {
    return `assign ${stringValue(payload["operator"]) ?? ""}`.trim();
  }
  if (astType === "BinaryExpr") {
    return `binary ${stringValue(payload["operator"]) ?? ""}`.trim();
  }
  return astType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function buildJavaAstDetail(astType: string, payload: Record<string, unknown>): string | undefined {
  if (astType === "ImportDeclaration" || astType === "PackageDeclaration") {
    return extractQualifiedName(payload["name"]);
  }
  if (astType === "MethodDeclaration" || astType === "ConstructorDeclaration") {
    return `${extractIdentifier(payload["name"]) ?? "method"}(${extractArrayLength(payload["parameters"])})`;
  }
  if (astType === "MethodCallExpr") {
    return `${extractQualifiedName(payload["scope"]) ? `${extractQualifiedName(payload["scope"])}.` : ""}${extractIdentifier(payload["name"]) ?? "call"}(${extractArrayLength(payload["arguments"])})`;
  }
  return undefined;
}

function buildMethodLabel(method: MethodIndexEntry): string {
  return `${method.name}(${method.parameters?.length ?? 0})`;
}

function buildJspMethodCallLabel(call: JspMethodCallIndexEntry): string {
  const owner = call.classPath ? `${simplifySymbol(call.classPath)}.` : "";
  return `${owner}${call.methodName}()`;
}

function compactSnippet(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function resolveReferenceTargetPath(
  snapshot: ProjectionSnapshot,
  file: ProjectionFileEntry,
  candidates: Array<string | undefined>
): string | undefined {
  for (const candidate of candidates.filter((value): value is string => Boolean(value))) {
    for (const reference of file.references) {
      if (reference.path === candidate) {
        return reference.path;
      }
      for (const symbol of reference.symbols) {
        if (symbol === candidate) {
          return reference.path;
        }
        if (symbol.startsWith(`${candidate}#`) || candidate.startsWith(`${symbol}#`)) {
          return reference.path;
        }
      }
    }
  }
  return undefined;
}

function extractLocation(value: unknown): JavaSourceLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    line: numberValue(value["beginLine"]),
    column: numberValue(value["beginColumn"]),
    endLine: numberValue(value["endLine"]),
    endColumn: numberValue(value["endColumn"])
  };
}

function containsLocation(container: JavaSourceLocation, value: JavaSourceLocation): boolean {
  const containerStart = toLocationScore(container.line, container.column);
  const containerEnd = toLocationScore(container.endLine, container.endColumn);
  const valueStart = toLocationScore(value.line, value.column);
  const valueEnd = toLocationScore(value.endLine, value.endColumn);
  return valueStart >= containerStart && valueEnd <= containerEnd;
}

function toLocationScore(line?: number, column?: number): number {
  return (line ?? 0) * 10_000 + (column ?? 0);
}

function serializeLocation(location?: JavaSourceLocation): string | undefined {
  if (!location?.line || !location?.column) {
    return undefined;
  }
  return [location.line, location.column, location.endLine ?? location.line, location.endColumn ?? location.column].join(":");
}

function simplifyAstType(rawType?: string): string | undefined {
  if (!rawType) {
    return undefined;
  }
  return rawType.split(".").at(-1);
}

function extractQualifiedName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const identifier = stringValue(value["identifier"]);
  const name = isRecord(value["name"]) ? extractQualifiedName(value["name"]) : undefined;
  if (name) {
    return name;
  }
  if (identifier) {
    const qualifier = extractQualifiedName(value["qualifier"]);
    return qualifier ? `${qualifier}.${identifier}` : identifier;
  }
  return undefined;
}

function extractIdentifier(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return stringValue(value["identifier"]) ?? extractQualifiedName(value);
}

function extractVariableNames(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = value
    .map((entry) => (isRecord(entry) ? extractIdentifier(entry["name"]) : undefined))
    .filter((entry): entry is string => Boolean(entry));
  return names.length > 0 ? names.join(", ") : undefined;
}

function extractTypeName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return extractIdentifier(value["name"]) ?? extractQualifiedName(value["name"]) ?? extractQualifiedName(value);
}

function extractArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function simplifySymbol(value: string): string {
  const normalized = value.includes("#") ? value.split("#")[0] : value;
  return normalized.split(".").at(-1) ?? normalized;
}

function metadataFilePath(snapshot: ProjectionSnapshot, file: ProjectionFileEntry): string {
  return path.join(snapshot.analysisOut, "index", file.metadataPath ?? "");
}

function javaAstFilePath(snapshot: ProjectionSnapshot, filePath: string): string {
  return path.join(snapshot.analysisOut, "java-ast", `${filePath}.json`);
}

async function loadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function normalizePath(targetPath: string): string {
  return targetPath.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
