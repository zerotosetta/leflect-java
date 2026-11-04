import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import type { JavaIndex, MethodIndexEntry } from "@leflect-java/indexer";
import type { JspDocumentNode, JspDocumentRoot, TaglibDirective } from "@leflect-java/parser-jsp";
import type { ElAstNode, JspFunctionReference, LeflectConfig, TldRegistryEntry } from "@leflect-java/schema";

const run = promisify(execFile);
const STANDARD_FUNCTION_URIS = new Set([
  "http://java.sun.com/jsp/jstl/functions", "http://xmlns.jcp.org/jsp/jstl/functions", "jakarta.tags.functions"
]);
type Signature = { returnType: string; name: string; parameters: string[] };
type FunctionDocument = { path: string; document?: JspDocumentRoot; taglibs: readonly TaglibDirective[] };
type SourceType = { type?: string; reason?: string };
type SourceTypeResolver = (raw: string | undefined, method: MethodIndexEntry) => Promise<SourceType>;

export async function resolveJspFunctions(
  config: Pick<LeflectConfig, "root" | "java">,
  docs: readonly FunctionDocument[],
  registry: readonly TldRegistryEntry[],
  javaIndex: Pick<JavaIndex, "classes" | "methods" | "imports">
): Promise<Map<string, JspFunctionReference[]>> {
  const registryByUri = new Map(registry.filter((entry) => entry.uri).map((entry) => [entry.uri!, entry]));
  const external = new Map<string, Promise<string>>();
  const javap = config.java?.javaHome
    ? path.join(config.java.javaHome, "bin", process.platform === "win32" ? "javap.exe" : "javap")
    : "javap";
  const inspect = (className: string): Promise<string> => {
    let result = external.get(className);
    if (!result) {
      const args = ["-public", ...(config.java?.classpath?.length ? ["-classpath", config.java.classpath.join(path.delimiter)] : []), className];
      result = run(javap, args, { timeout: 15_000, maxBuffer: 2_000_000 }).then(({ stdout }) => stdout, () => "");
      external.set(className, result);
    }
    return result;
  };
  const sourceTypes = new Map<string, Promise<SourceType>>();
  const resolveType: SourceTypeResolver = (raw, method) => {
    const key = method.file + ":" + method.classId + ":" + raw;
    let resolved = sourceTypes.get(key);
    if (!resolved) {
      resolved = resolveSourceType(raw, method, javaIndex, async (className) =>
        javaIndex.classes.some(entry => entry.id === className) || Boolean(await inspect(className)));
      sourceTypes.set(key, resolved);
    }
    return resolved;
  };
  const result = new Map<string, JspFunctionReference[]>();
  for (const doc of docs) {
    if (!doc.document) continue;
    const source = await fs.readFile(path.resolve(config.root, doc.path), "utf8");
    const uris = new Map(doc.taglibs.map(({ prefix, uri }) => [prefix, uri]));
    const references: JspFunctionReference[] = [];
    for (const expression of expressionNodes(doc.document)) {
      const expected = new Set(elFunctions(expression.ast).map(({ prefix, name }) => prefix + ":" + name));
      const visible = expression.raw.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (text) => " ".repeat(text.length));
      for (const match of visible.matchAll(/\b([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\s*\(/g)) {
        const [, prefix, name] = match;
        if (!expected.has(prefix + ":" + name)) continue;
        const uri = uris.get(prefix);
        const tld = uri ? registryByUri.get(uri) : undefined;
        if (!tld && uri && STANDARD_FUNCTION_URIS.has(uri)) continue;
        const declaration = tld?.functions?.find((item) => item.name === name);
        const signature = declaration && parseSignature(declaration.functionSignature);
        const offset = lineOffset(source, expression.lineRange.startLine, expression.lineRange.startColumn) + match.index!;
        const reference: JspFunctionReference = {
          prefix, name, uri, className: declaration?.functionClass,
          methodName: signature?.name, parameterTypes: signature?.parameters, returnType: signature?.returnType,
          declarationPath: tld?.sourcePath,
          declarationLineRange: declaration?.lineRange,
          location: sourceLocation(source, offset, offset + prefix.length + name.length),
          validation: "unresolved"
        };
        if (!declaration || !signature) {
          reference.unresolvedReason = declaration ? "Invalid TLD function signature" : "No function declaration for " + prefix + ":" + name;
        } else {
          const className = declaration.functionClass;
          const sourceClass = javaIndex.classes.find((entry) => entry.id === className);
          if (sourceClass) {
            const matches = await Promise.all(javaIndex.methods.filter(entry => entry.classId === className &&
              entry.name === signature.name).map(async method => ({ method, ...await matchesSourceMethod(method, signature, resolveType) })));
            const matching = matches.filter(entry => entry.matched);
            if (matching.length === 1) {
              reference.targetFile = sourceClass.file;
              reference.validation = "source";
            } else {
              const reason = matches.find(entry => entry.reason?.startsWith("Ambiguous"))?.reason ?? matches.find(entry => entry.reason)?.reason;
              reference.unresolvedReason = matching.length > 1 ? "Ambiguous public static source methods for the declared function signature"
                : "No matching public static source method for the declared function signature" + (reason ? ": " + reason : "");
            }
          } else {
            const listing = await inspect(className);
            const matches = listing.split(/\r?\n/).some((line) => {
              if (!/\bpublic\s+(?:(?:final|synchronized|native|strictfp)\s+)*static\b|\bpublic\s+static\b/.test(line)) return false;
              const candidate = parseSignature(line.trim().replace(/;\s*$/, "").replace(/\s+throws\s+.*$/, "")
                .replace(/^(?:(?:public|static|final|synchronized|native|strictfp)\s+)+/, ""));
              return candidate && signatureEquals(candidate, signature);
            });
            if (matches) reference.validation = "classpath";
            else reference.unresolvedReason = listing
              ? "No matching public static classpath method for the declared function signature"
              : "Function class could not be inspected using the configured Java classpath";
          }
          if (reference.validation !== "unresolved") {
            reference.methodId = className + "#" + signature.name + "(" + signature.parameters.join(",") + ")";
          }
        }
        references.push(reference);
      }
    }
    if (references.length) result.set(doc.path, references);
  }
  return result;
}

function parseSignature(raw: string): Signature | undefined {
  const match = raw.trim().match(/^([\w.$\[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)$/);
  if (!match) return undefined;
  const parameters = match[3].trim() ? match[3].split(",").map((value) => value.trim().replace(/\.\.\.$/, "[]")) : [];
  return parameters.every((value) => /^[\w.$\[\]]+$/.test(value))
    ? { returnType: match[1], name: match[2], parameters } : undefined;
}

function signatureEquals(a: Signature, b: Signature): boolean {
  return a.name === b.name && a.returnType === b.returnType &&
    a.parameters.length === b.parameters.length && a.parameters.every((type, i) => type === b.parameters[i]);
}

async function matchesSourceMethod(method: MethodIndexEntry, signature: Signature, resolveType: SourceTypeResolver): Promise<{ matched: boolean; reason?: string }> {
  const modifiers = new Set((method.modifiers ?? []).map((value) => value.toLowerCase()));
  if (!modifiers.has("public") || !modifiers.has("static") || method.name !== signature.name ||
      (method.parameters ?? []).length !== signature.parameters.length) return { matched: false };
  const declared = await Promise.all([method.returnType, ...(method.parameters ?? [])].map(type => resolveType(type, method)));
  const expected = [signature.returnType, ...signature.parameters];
  const invalid = declared.findIndex((type, i) => type.type !== expected[i]);
  return invalid < 0 ? { matched: true } : {
    matched: false,
    reason: declared[invalid].reason ?? "Source type " + declared[invalid].type + " does not match declared type " + expected[invalid]
  };
}

async function resolveSourceType(
  raw: string | undefined,
  method: MethodIndexEntry,
  index: Pick<JavaIndex, "imports" | "classes">,
  exists: (className: string) => Promise<boolean>
): Promise<SourceType> {
  if (!raw) return { reason: "Source type is unavailable" };
  const actual = raw.replace(/\s+/g, "").replace(/\.\.\.$/, "[]");
  const dimensions = actual.match(/(?:\[\])+$/)?.[0] ?? "";
  const base = actual.slice(0, actual.length - dimensions.length);
  if (/^(?:void|boolean|byte|char|short|int|long|float|double)$/.test(base)) return { type: actual };
  if (!/^[\w$]+(?:\.[\w$]+)*$/.test(base)) return { reason: "Source type cannot be canonicalized: " + raw };
  // A qualified declaration already records its package; relative nested types are
  // resolved through the root type's imports below.
  if (base.includes(".") && await exists(base)) return { type: base + dimensions };
  const [simple, ...members] = base.split(".");
  const suffix = members.length ? "." + members.join(".") : "";
  const imports = index.imports.filter((entry) => entry.file === method.file).map((entry) => entry.import);
  const explicit = imports.filter((entry) => !entry.endsWith(".*") && entry.split(".").at(-1) === simple);
  const sourceClass = index.classes.find((entry) => entry.id === method.classId);
  // Enclosing/member types and compilation-unit declarations shadow imports.
  let scope = method.classId;
  while (scope && scope !== sourceClass?.packageName) {
    const member = scope.split(".").at(-1) === simple ? scope : scope + "." + simple;
    if (index.classes.some(entry => entry.id === member)) return { type: member + suffix + dimensions };
    scope = scope.includes(".") ? scope.slice(0, scope.lastIndexOf(".")) : undefined;
  }
  const packageType = (sourceClass?.packageName ? sourceClass.packageName + "." : "") + simple;
  const local = index.classes.find(entry => entry.file === method.file && entry.id === packageType);
  if (local) return { type: packageType + suffix + dimensions };
  if (explicit.length) return explicit.length === 1 ? { type: explicit[0] + suffix + dimensions }
    : { reason: "Ambiguous explicit imports for source type " + simple };
  if (await exists(packageType)) return { type: packageType + suffix + dimensions };
  const candidates = [...new Set(["java.lang." + simple, ...imports.filter(entry => entry.endsWith(".*"))
    .map(entry => entry.slice(0, -1) + simple)])];
  const available = (await Promise.all(candidates.map(async candidate => await exists(candidate) ? candidate : undefined)))
    .filter((candidate): candidate is string => Boolean(candidate));
  if (available.length > 1) return { reason: "Ambiguous source type " + simple + ": " + available.join(", ") };
  return available.length === 1 ? { type: available[0] + suffix + dimensions }
    : { reason: "Source type could not be verified in the analysis environment: " + raw };
}

function* expressionNodes(node: JspDocumentNode): Iterable<Extract<JspDocumentNode, { kind: "ElExpression" }>> {
  if (node.kind === "ElExpression") yield node;
  if ("children" in node) for (const child of node.children) yield* expressionNodes(child);
  if ("attributeNodes" in node) for (const attribute of node.attributeNodes ?? []) yield* expressionNodes(attribute);
}

function elFunctions(ast: ElAstNode): Array<{ prefix: string; name: string }> {
  const result: Array<{ prefix: string; name: string }> = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.kind === "FunctionCallExpression" && typeof node.namespace === "string" && typeof node.functionName === "string") {
      result.push({ prefix: node.namespace, name: node.functionName });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return result;
}

function lineOffset(source: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) offset = source.indexOf("\n", offset) + 1;
  return offset + column - 1;
}

function sourceLocation(source: string, start: number, end: number) {
  const before = source.slice(0, start).split("\n");
  const after = source.slice(0, end).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1, endLine: after.length, endColumn: after.at(-1)!.length + 1 };
}
