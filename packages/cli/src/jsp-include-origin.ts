import fs from "fs/promises";
import path from "path";

import type { JavaSummaryMethod, JavaSummaryMethodCall, JavaSummaryRecord } from "@leflect-java/indexer";
import type { JspIncludeReference } from "@leflect-java/schema";

type Evidence = NonNullable<JspIncludeReference["evidence"]>[number];
type Location = NonNullable<Evidence["location"]>;
type AstRange = { beginLine: number; beginColumn: number; endLine: number; endColumn: number };
type AstNode = {
  "!"?: string;
  range?: AstRange;
  name?: AstNode;
  identifier?: string;
  value?: string | AstNode;
  scope?: AstNode;
  expression?: AstNode;
  initializer?: AstNode;
  arguments?: AstNode[];
  parameters?: AstNode[];
  target?: AstNode;
  operator?: string;
  thenExpr?: AstNode;
  elseExpr?: AstNode;
  inner?: AstNode;
};
type Method = { file: JavaSummaryRecord; summary: JavaSummaryMethod };
type Body = {
  method: Method;
  nodes: AstNode[];
  calls: Map<string, JavaSummaryMethodCall>;
  branches: Map<AstNode, AstNode[]>;
  parameters: Map<string, number>;
};
type Arguments = { body: Body; nodes: AstNode[]; parent?: Arguments };
type Trace = {
  evidence: Evidence[];
  visited: Set<string>;
  add: (body: Body, node: AstNode, description: string) => void;
};

const MAX_TRACE_DEPTH = 14;
const MAX_EVIDENCE = 40;
const MAX_ALIAS_DEPTH = 6;
const COLLECTION_WRITES = new Set(["add", "addAll", "offer", "put", "putAll", "replace", "set"]);
const BRANCH_NODES = new Set(["IfStmt", "WhileStmt", "DoStmt", "ForStmt", "ForEachStmt", "SwitchEntry"]);

export function createServletAttributeTrace(analysisOut: string, summaries: readonly JavaSummaryRecord[]) {
  const methods = new Map<string, Method[]>();
  const methodsByFile = new Map<JavaSummaryRecord, Map<string, Method>>();
  const attributeWrites = new Map<string, Array<{ file: JavaSummaryRecord; call: JavaSummaryMethodCall }>>();
  for (const file of summaries) {
    const fileMethods = new Map<string, Method>();
    methodsByFile.set(file, fileMethods);
    for (const type of file.types ?? []) {
      for (const summary of type.methods ?? []) {
        const key = `${type.fqn}#${summary.name}`;
        const entries = methods.get(key) ?? [];
        const method = { file, summary };
        entries.push(method);
        fileMethods.set(summary.id, method);
        methods.set(key, entries);
      }
    }
    for (const call of file.methodCalls ?? []) {
      const owner = call.resolvedClassId ?? call.targetClassId;
      const attribute = call.argumentExpressions?.[0]?.match(/^"([A-Za-z_$][\w$]*)"$/)?.[1];
      if (!attribute || call.targetMethodName !== "setAttribute" || !owner?.match(
        /^(?:javax|jakarta)\.servlet\.(?:ServletRequest|http\.HttpServletRequest)$/
      )) {
        continue;
      }
      const entries = attributeWrites.get(attribute) ?? [];
      entries.push({ file, call });
      attributeWrites.set(attribute, entries);
    }
  }

  const astByFile = new Map<string, Promise<AstNode | undefined>>();
  const bodies = new Map<Method, Promise<Body | undefined>>();
  function loadBody(method: Method): Promise<Body | undefined> {
    const existing = bodies.get(method);
    if (existing) {
      return existing;
    }
    const build = async (): Promise<Body | undefined> => {
      const file = method.file.path;
      let ast = astByFile.get(file);
      if (!ast) {
        ast = fs.readFile(path.join(analysisOut, "java-ast", `${file}.json`), "utf8")
          .then((source) => JSON.parse(source) as AstNode, () => undefined)
          .catch(() => undefined);
        astByFile.set(file, ast);
      }
      const root = await ast;
      if (!root) {
        return undefined;
      }
      const declaration = [...walk(root)].find((node) => {
        const kind = kindOf(node);
        const methodLocation = method.summary.location;
        return (kind === "MethodDeclaration" || kind === "ConstructorDeclaration") &&
          node.name?.identifier === method.summary.name && Boolean(methodLocation) &&
          (node.range?.beginLine === methodLocation?.line || node.name?.range?.beginLine === methodLocation?.line);
      });
      if (!declaration) {
        return undefined;
      }

      const nodes: AstNode[] = [];
      const branches = new Map<AstNode, AstNode[]>();
      function collect(node: AstNode, enclosing: AstNode[]) {
        const kind = kindOf(node);
        if (node !== declaration && (kind.endsWith("Declaration") || kind === "LambdaExpr")) {
          return;
        }
        nodes.push(node);
        branches.set(node, enclosing);
        const next = BRANCH_NODES.has(kind) ? [...enclosing, node] : enclosing;
        for (const child of childrenOf(node)) {
          collect(child, next);
        }
      }
      collect(declaration, []);
      const calls = new Map(
        (method.file.methodCalls ?? []).filter((call) => call.callerMethodId === method.summary.id && call.location)
          .map((call) => [callKey(call.location!, call.targetMethodName), call])
      );
      const parameters = new Map((declaration.parameters ?? []).flatMap((parameter, index) => {
        const name = parameter.name?.identifier;
        return name ? [[name, index] as const] : [];
      }));
      return { method, nodes, calls, branches, parameters };
    };
    const loaded = build();
    bodies.set(method, loaded);
    return loaded;
  }

  const traceResults = new Map<string, Promise<Evidence[]>>();
  return (attribute: string, property?: string): Promise<Evidence[]> => {
    const key = `${attribute}.${property ?? ""}`;
    const existing = traceResults.get(key);
    if (existing) {
      return existing;
    }
    const pending = findAttributeOrigin(attribute, property);
    traceResults.set(key, pending);
    return pending;
  };

  async function findAttributeOrigin(attribute: string, property?: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const trace: Trace = {
      evidence,
      visited: new Set(),
      add(body, node, description) {
        const file = body.method.file.path;
        const location = locationOf(node);
        if (evidence.length < MAX_EVIDENCE && !evidence.some((item) =>
          item.description === description && item.path === file && sameStart(item.location, location))) {
          evidence.push({ description, path: file, location });
        }
      }
    };
    for (const { file, call } of attributeWrites.get(attribute) ?? []) {
      evidence.push({
        description: `Servlet request attribute "${attribute}"${property ? ` supplies property "${property}"` : ""}`,
        path: file.path,
        location: completeLocation(call.location)
      });
      const caller = call.callerMethodId ? methodsByFile.get(file)?.get(call.callerMethodId) : undefined;
      const body = caller && await loadBody(caller);
      const statement = body?.nodes.find((node) => kindOf(node) === "MethodCallExpr" &&
        node.name?.identifier === "setAttribute" && sameStart(locationOf(node), call.location));
      if (body && statement?.arguments?.[1]) {
        await traceExpression(body, statement.arguments[1], property, trace, 0);
      }
      if (evidence.length >= MAX_EVIDENCE) {
        break;
      }
    }
    return evidence;
  }

  async function traceExpression(
    body: Body,
    node: AstNode,
    property: string | undefined,
    trace: Trace,
    depth: number,
    bindings?: Arguments
  ): Promise<void> {
    if (depth >= MAX_TRACE_DEPTH || trace.evidence.length >= MAX_EVIDENCE) {
      return;
    }
    const location = locationOf(node);
    const key = `${body.method.file.path}:${location?.line}:${location?.column}:${location?.endColumn}:${property ?? ""}`;
    if (trace.visited.has(key)) {
      return;
    }
    trace.visited.add(key);
    const next = depth + 1;
    const follow = (child: AstNode, selectedProperty = property) =>
      traceExpression(body, child, selectedProperty, trace, next, bindings);
    const kind = kindOf(node);
    if (kind === "NameExpr" && node.name?.identifier) {
      const variable = node.name.identifier;
      if (property) {
        for (const record of body.nodes.filter((candidate) => precedes(candidate, node))) {
          let value: AstNode | undefined;
          if (kindOf(record) === "AssignExpr" && record.operator === "ASSIGN" && record.target &&
              referencesProperty(body, record.target, variable, property, new Set())) {
            value = typeof record.value === "object" ? record.value : undefined;
          } else if (kindOf(record) === "MethodCallExpr" && record.scope &&
              COLLECTION_WRITES.has(record.name?.identifier ?? "") &&
              referencesProperty(body, record.scope, variable, property, new Set())) {
            value = record.arguments?.at(-1);
          }
          if (value && typeof value === "object") {
            const branches = body.branches.get(record) ?? [];
            trace.add(body, record, `Possible write to ${variable}.${property}${branches.length ? " inside a branch or loop" : ""}`);
            await traceExpression(body, value, undefined, trace, next, bindings);
          }
        }
      }
      const definitions = localDefinitions(body, variable, node);
      for (const definition of definitions) {
        await follow(definition);
      }
      const parameter = body.parameters.get(variable);
      const argument = parameter !== undefined ? bindings?.nodes[parameter] : undefined;
      if (definitions.length === 0 && bindings && argument) {
        await traceExpression(bindings.body, argument, property, trace, next, bindings.parent);
      }
      return;
    }
    if (kind === "EnclosedExpr" || kind === "CastExpr") {
      const inner = node.inner ?? node.expression;
      if (inner) {
        await follow(inner);
      }
      return;
    }
    if (kind === "ConditionalExpr") {
      for (const choice of [node.thenExpr, node.elseExpr]) {
        if (choice) {
          await follow(choice);
        }
      }
      return;
    }
    if (kind !== "MethodCallExpr" || !location) {
      return;
    }
    const call = body.calls.get(callKey(location, node.name?.identifier));
    if (!call) {
      return;
    }
    const owner = call.resolvedClassId ?? call.targetClassId;
    const name = call.targetMethodName ?? node.name?.identifier;
    if (owner?.startsWith("java.sql.")) {
      const sql = node.arguments?.[0];
      const table = name === "prepareStatement" && typeof sql?.value === "string"
        ? sql.value.match(/\bFROM\s+([A-Za-z_][\w$.]*)/i)?.[1] : undefined;
      trace.add(body, node, table
        ? `Prepared SQL reads ${table}`
        : `Database value through ${owner}.${name}`);
      if (node.scope) {
        await traceExpression(body, node.scope, undefined, trace, next, bindings);
      }
      return;
    }
    if (!owner || !name) {
      return;
    }
    const overloads = (methods.get(`${owner}#${name}`) ?? [])
      .filter((method) => (method.summary.parameters ?? []).length === (node.arguments ?? []).length);
    const targetId = call.resolvedMethodId ?? call.targetMethodId;
    const exact = targetId && overloads.find((method) => method.summary.id === targetId);
    const candidate = exact || (overloads.length === 1 ? overloads[0] : undefined);
    if (!candidate) {
      return;
    }
    trace.add(body, node, `Value from ${owner}.${name}()`);
    const target = await loadBody(candidate);
    if (target) {
      for (const returned of target.nodes) {
        if (kindOf(returned) === "ReturnStmt" && returned.expression) {
          await traceExpression(target, returned.expression, property, trace, next, {
            body, nodes: node.arguments ?? [], parent: bindings
          });
        }
      }
    }
  }
}

function referencesProperty(body: Body, node: AstNode, variable: string, property: string, aliases: Set<string>): boolean {
  const kind = kindOf(node);
  if (kind === "FieldAccessExpr" && node.scope?.name?.identifier === variable && node.name?.identifier === property) {
    return true;
  }
  if (kind === "NameExpr" && node.name?.identifier &&
      aliases.size < MAX_ALIAS_DEPTH && !aliases.has(node.name.identifier)) {
    const name = node.name.identifier;
    const next = new Set([...aliases, name]);
    return localDefinitions(body, name, node).some((value) => referencesProperty(body, value, variable, property, next));
  }
  return Boolean(node.scope && referencesProperty(body, node.scope, variable, property, aliases));
}

function localDefinitions(body: Body, variable: string, before: AstNode): AstNode[] {
  const definitions: AstNode[] = [];
  for (const node of body.nodes) {
    if (!precedes(node, before)) {
      continue;
    }
    if (kindOf(node) === "VariableDeclarator" && node.name?.identifier === variable && node.initializer) {
      definitions.push(node.initializer);
    } else if (kindOf(node) === "AssignExpr" && node.operator === "ASSIGN" &&
        kindOf(node.target) === "NameExpr" && node.target?.name?.identifier === variable &&
        node.value && typeof node.value === "object") {
      definitions.push(node.value);
    }
  }
  return definitions;
}

function* walk(node: AstNode): Iterable<AstNode> {
  yield node;
  for (const child of childrenOf(node)) {
    yield* walk(child);
  }
}

function* childrenOf(node: AstNode): Iterable<AstNode> {
  for (const [key, value] of Object.entries(node)) {
    if (key === "tokenRange" || key === "range" || key === "anonymousClassBody") {
      continue;
    }
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === "object" && "!" in child && typeof child["!"] === "string") {
        yield child as AstNode;
      }
    }
  }
}

function kindOf(node: AstNode | undefined): string {
  return node?.["!"]?.split(".").at(-1) ?? "";
}

function locationOf(node: AstNode): Location | undefined {
  const range = node.range;
  return range ? { line: range.beginLine, column: range.beginColumn, endLine: range.endLine, endColumn: range.endColumn } : undefined;
}

function completeLocation(location: JavaSummaryMethodCall["location"]): Location | undefined {
  if (location?.line === undefined || location.column === undefined) {
    return undefined;
  }
  return {
    line: location.line,
    column: location.column,
    endLine: location.endLine ?? location.line,
    endColumn: location.endColumn ?? location.column
  };
}

function sameStart(left: Partial<Location> | undefined, right: Partial<Location> | undefined): boolean {
  return Boolean(left && right && left.line === right.line && left.column === right.column);
}

function precedes(left: AstNode, right: AstNode): boolean {
  const a = left.range;
  const b = right.range;
  return Boolean(a && b && (a.beginLine < b.beginLine || (a.beginLine === b.beginLine && a.beginColumn < b.beginColumn)));
}

function callKey(location: Partial<Location>, method: string | undefined): string {
  return `${location.line}:${location.column}:${method ?? ""}`;
}
