import fs from "fs/promises";
import path from "path";

import type { JavaSummaryRecord } from "@leflect-java/indexer";
import { parseEl, parseJsp } from "@leflect-java/parser-jsp";
import type { JspDocumentNode, JspDocumentRoot, TaglibDirective } from "@leflect-java/parser-jsp";
import type { ElAstNode, JspIncludeReference, LeflectConfig } from "@leflect-java/schema";

import { createServletAttributeTrace } from "./jsp-include-origin";

type IncludeDocument = {
  path: string;
  document?: JspDocumentRoot;
  taglibs?: readonly TaglibDirective[];
};
type IncludeEvidence = NonNullable<JspIncludeReference["evidence"]>[number];
type IncludeBinding = { value: string; evidence: IncludeEvidence };
type IncludeSite = {
  reference: JspIncludeReference;
  bindings: ReadonlyMap<string, IncludeBinding>;
};

const EL_START = /(?:\$|#)\{/;
const WHOLE_EL = /^(?:\$|#)\{[\s\S]*\}$/;
const JSTL_CORE_URIS = new Set([
  "http://java.sun.com/jsp/jstl/core",
  "http://xmlns.jcp.org/jsp/jstl/core",
  "jakarta.tags.core"
]);

export async function resolveJspIncludes(
  config: Pick<LeflectConfig, "root" | "jsp" | "analysisOut">,
  docs: readonly IncludeDocument[],
  javaSummaries: readonly JavaSummaryRecord[]
): Promise<Map<string, JspIncludeReference[]>> {
  const webRoot = path.resolve(config.root, config.jsp?.webappRoot ?? ".");
  const realWebRoot = await existingRealPath(webRoot);
  const realProjectRoot = await existingRealPath(config.root);
  const resolveTarget = async (jspPath: string, page: string): Promise<string | undefined> => {
    const pathname = page.split(/[?#]/, 1)[0];
    if (!pathname || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(pathname) || pathname.includes("\\")) {
      return undefined;
    }
    const target = pathname.startsWith("/")
      ? path.resolve(webRoot, `.${pathname}`)
      : path.resolve(config.root, path.dirname(jspPath), pathname);
    if (!isWithin(webRoot, target) || !isWithin(config.root, target)) {
      return undefined;
    }
    const realTarget = await existingRealPath(target);
    if (!realTarget || !realWebRoot || !realProjectRoot ||
        !isWithin(realWebRoot, realTarget) || !isWithin(realProjectRoot, realTarget)) {
      return undefined;
    }
    const stat = await fs.stat(realTarget).catch(() => undefined);
    return stat?.isFile() ? path.relative(config.root, target).replace(/\\/g, "/") : undefined;
  };

  const traceAttribute = createServletAttributeTrace(config.analysisOut, javaSummaries);
  const result = new Map<string, JspIncludeReference[]>();
  for (const doc of docs) {
    const document = doc.document ?? await fs.readFile(path.resolve(config.root, doc.path), "utf8")
      .then((source) => parseJsp(source).document, () => undefined);
    if (!document) {
      continue;
    }
    const sites = collectIncludeSites(doc, document);
    for (const { reference, bindings } of sites) {
      if (reference.kind === "static") {
        reference.targetPath = await resolveTarget(doc.path, reference.page);
        if (!reference.targetPath) {
          reference.unresolvedReason = "No local resource matches the include path";
        }
        continue;
      }

      const evidence = reference.evidence ?? [];
      const flow = traceEl(reference.page, bindings);
      evidence.push(...flow.evidence);
      for (const { attribute, property } of flow.roots) {
        evidence.push(...await traceAttribute(attribute, property));
      }

      const supplied = config.jsp?.includeTargets;
      const configured = supplied && Object.hasOwn(supplied, reference.page) ? supplied[reference.page] : undefined;
      if (configured !== undefined) {
        const target = await resolveTarget(doc.path, configured);
        if (target) {
          reference.targetPath = target;
          evidence.push({ description: `Configured include target: ${configured}`, path: target });
        } else {
          reference.unresolvedReason = `Configured include target does not resolve to a local file: ${configured}`;
        }
      } else if (flow.literals?.length) {
        const targets = await Promise.all(flow.literals.map((literal) => resolveTarget(doc.path, literal)));
        if (targets.every((target): target is string => target !== undefined)) {
          const distinct = [...new Set(targets)];
          if (distinct.length === 1) {
            reference.targetPath = distinct[0];
          } else {
            reference.candidatePaths = distinct;
          }
        }
      }
      if (!reference.targetPath && !reference.candidatePaths && !reference.unresolvedReason) {
        reference.unresolvedReason = "The include target depends on a runtime value";
      }
      reference.evidence = evidence;
    }
    if (sites.length > 0) {
      result.set(doc.path, sites.map(({ reference }) => reference));
    }
  }
  return result;
}

function collectIncludeSites(doc: IncludeDocument, document: JspDocumentRoot): IncludeSite[] {
  const sites: IncludeSite[] = [];
  const corePrefixes = new Set((doc.taglibs ?? [])
    .filter(({ uri }) => JSTL_CORE_URIS.has(uri))
    .map(({ prefix }) => prefix));
  const visit = (
    children: JspDocumentNode[],
    inherited: ReadonlyMap<string, IncludeBinding>,
    conditions: IncludeEvidence[]
  ): void => {
    const bindings = new Map(inherited);
    for (const node of children) {
      if (node.kind === "HtmlElement") {
        visit(node.children, bindings, conditions);
        continue;
      }
      if (node.kind !== "CustomTagElement") {
        continue;
      }
      const location = locationOf(node);
      const isJstl = corePrefixes.has(node.prefix);
      if (isJstl && node.name === "set" && node.attributes.var && node.attributes.value !== undefined &&
          (!node.attributes.scope || node.attributes.scope === "page")) {
        const { var: variable, value } = node.attributes;
        bindings.set(variable, {
          value,
          evidence: { description: `Possible assignment: ${variable} is set from ${value}`, path: doc.path, location }
        });
      }
      if (node.prefix === "jsp" && node.name === "include" && node.attributes.page?.trim()) {
        const page = node.attributes.page.trim();
        sites.push({
          bindings: new Map(bindings),
          reference: {
            page,
            location,
            kind: EL_START.test(page) || page.includes("<%") ? "dynamic" : "static",
            parameters: node.children.flatMap((child) =>
              child.kind === "CustomTagElement" && child.prefix === "jsp" && child.name === "param" &&
                child.attributes.name !== undefined && child.attributes.value !== undefined
                ? [{ name: child.attributes.name, value: child.attributes.value, location: locationOf(child) }]
                : []),
            evidence: [...conditions]
          }
        });
      }
      const nested = new Map(bindings);
      const evidence = [...conditions];
      if (isJstl && (node.name === "if" || node.name === "when") && node.attributes.test) {
        evidence.push({ description: `JSP condition: ${node.attributes.test}`, path: doc.path, location });
      }
      if (isJstl && node.name === "forEach" && node.attributes.var && node.attributes.items) {
        const { var: variable, items } = node.attributes;
        nested.set(variable, {
          value: items,
          evidence: { description: `${variable} iterates over ${items}`, path: doc.path, location }
        });
      }
      visit(node.children, nested, evidence);
    }
  };
  visit(document.children, new Map(), []);
  return sites;
}

function traceEl(page: string, bindings: ReadonlyMap<string, IncludeBinding>) {
  const evidence: IncludeEvidence[] = [];
  const roots = new Map<string, { attribute: string; property?: string }>();
  const trace = (node: ElAstNode, visiting: ReadonlySet<string>, property?: string): string[] | undefined => {
    switch (node.kind) {
      case "LiteralExpression":
        return !property && typeof node.value === "string" ? [node.value] : undefined;
      case "GroupedExpression":
        return trace(node.expression, visiting, property);
      case "TernaryExpression": {
        if (node.test.kind === "LiteralExpression" && typeof node.test.value === "boolean") {
          return trace(node.test.value ? node.consequent : node.alternate, visiting, property);
        }
        trace(node.test, visiting);
        const a = trace(node.consequent, visiting, property);
        const b = trace(node.alternate, visiting, property);
        return a && b ? [...new Set([...a, ...b])] : undefined;
      }
      case "PropertyAccessExpression":
        if (node.target.kind === "IdentifierExpression" && node.target.name === "requestScope") {
          roots.set(`${node.property}.${property ?? ""}`, { attribute: node.property, property });
          return undefined;
        }
        return trace(node.target, visiting, node.property);
      case "IndexAccessExpression":
        if (node.index.kind === "LiteralExpression" && typeof node.index.value === "string") {
          if (node.target.kind === "IdentifierExpression" && node.target.name === "requestScope") {
            roots.set(`${node.index.value}.${property ?? ""}`, { attribute: node.index.value, property });
            return undefined;
          }
          trace(node.target, visiting, node.index.value);
          return undefined;
        }
        trace(node.index, visiting);
        trace(node.target, visiting, property);
        return undefined;
      case "IdentifierExpression": {
        if (visiting.has(node.name)) {
          return undefined;
        }
        const binding = bindings.get(node.name);
        if (binding) {
          evidence.push(binding.evidence);
          if (WHOLE_EL.test(binding.value)) {
            trace(parseEl(binding.value), new Set([...visiting, node.name]), property);
          }
          return undefined;
        }
        if (node.name === "param" || node.name === "paramValues") {
          evidence.push({ description: `Request parameter${property ? `: ${property}` : ""}` });
        } else {
          roots.set(`${node.name}.${property ?? ""}`, { attribute: node.name, property });
        }
        return undefined;
      }
      case "FunctionCallExpression":
        trace(node.callee, visiting);
        for (const argument of node.arguments) {
          trace(argument, visiting);
        }
        return undefined;
      case "BinaryExpression":
        trace(node.left, visiting);
        trace(node.right, visiting);
        return undefined;
      case "UnaryExpression":
        trace(node.argument, visiting);
        return undefined;
      default:
        return undefined;
    }
  };
  const literals = WHOLE_EL.test(page) ? trace(parseEl(page), new Set()) : undefined;
  return { evidence, roots: [...roots.values()], literals };
}

function locationOf(node: JspDocumentNode) {
  const { startLine, startColumn, endLine, endColumn } = node.lineRange;
  return { line: startLine, column: startColumn ?? 1, endLine, endColumn: endColumn ?? 1 };
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function existingRealPath(target: string): Promise<string | undefined> {
  return fs.realpath(target).catch(() => undefined);
}
