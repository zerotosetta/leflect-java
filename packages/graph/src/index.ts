import fs from "fs/promises";
import path from "path";

import { GraphConfidence, GraphEdge } from "@lefectjava/schema";

export type JavaCallRecord = {
  from?: string;
  to?: string;
};

export type GraphClassRecord = {
  id: string;
  name: string;
  file?: string;
};

export type GraphResolvedTag = {
  prefix: string;
  name: string;
  handlerClass?: string;
};

export type GraphJspRecord = {
  path: string;
  scriptlets: Array<{ kind: string; code: string }>;
  tags?: Array<{ prefix: string; name: string }>;
  resolvedTags?: GraphResolvedTag[];
};

export type GraphBuildResult = {
  javaCallEdges: GraphEdge[];
  jspJavaEdges: GraphEdge[];
};

export function buildJavaCallGraph(calls: JavaCallRecord[]): GraphEdge[] {
  return calls.map((call) => ({
    from: call.from ?? "unresolved:java-call:from",
    to: call.to ?? "unresolved:java-call:to",
    type: "JAVA_CALL",
    confidence: resolveJavaCallConfidence(call)
  }));
}

export function buildJspGraph(
  docs: GraphJspRecord[],
  classes: GraphClassRecord[]
): GraphEdge[] {
  const classLookup = buildClassLookup(classes);
  const edges: GraphEdge[] = [];

  for (const doc of docs) {
    for (const [index, scriptlet] of doc.scriptlets.entries()) {
      const resolvedClass = resolveScriptletClass(scriptlet.code, classLookup);
      edges.push({
        from: doc.path,
        to: resolvedClass ?? `unresolved:scriptlet:${doc.path}:${index}`,
        type: "JSP_SCRIPTLET_CALL",
        confidence: resolvedClass ? "low" : "unresolved"
      });
    }

    const resolvedTags = doc.resolvedTags ?? [];
    if (resolvedTags.length > 0) {
      for (const tag of resolvedTags) {
        edges.push({
          from: doc.path,
          to: tag.handlerClass ?? `unresolved:tag:${tag.prefix}:${tag.name}`,
          type: "JSP_USES_TAG",
          confidence: tag.handlerClass ? "high" : "unresolved"
        });
      }
      continue;
    }

    for (const [index, tag] of (doc.tags ?? []).entries()) {
      edges.push({
        from: doc.path,
        to: `unresolved:tag:${tag.prefix}:${tag.name}:${index}`,
        type: "JSP_USES_TAG",
        confidence: "unresolved"
      });
    }
  }

  return edges;
}

export function buildGraphs(
  calls: JavaCallRecord[],
  docs: GraphJspRecord[],
  classes: GraphClassRecord[]
): GraphBuildResult {
  return {
    javaCallEdges: buildJavaCallGraph(calls),
    jspJavaEdges: buildJspGraph(docs, classes)
  };
}

export async function writeGraphFiles(
  analysisOut: string,
  result: GraphBuildResult
): Promise<void> {
  const outDir = path.join(analysisOut, "graph");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "java-call.jsonl"),
    toJsonl(result.javaCallEdges)
  );
  await fs.writeFile(
    path.join(outDir, "jsp-java.jsonl"),
    toJsonl(result.jspJavaEdges)
  );
}

function resolveJavaCallConfidence(call: JavaCallRecord): GraphConfidence {
  if (call.from && call.to) {
    return "high";
  }
  return "unresolved";
}

function buildClassLookup(classes: GraphClassRecord[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const entry of classes) {
    lookup.set(entry.id, entry.id);
    lookup.set(entry.name, entry.id);
  }

  return lookup;
}

function resolveScriptletClass(code: string, classLookup: Map<string, string>): string | undefined {
  for (const [candidate, classId] of classLookup.entries()) {
    if (code.includes(candidate)) {
      return classId;
    }
  }

  return undefined;
}

function toJsonl(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}
