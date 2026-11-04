import fs from "fs/promises";
import path from "path";
import type { JspSemanticAst, JspSemanticNode, TaskCodeIndex, TaskCodeOccurrence } from "@leflect-java/schema";

const TASK_URI = "urn:demo:wfw";

export function buildTaskCodeIndex(asts: readonly JspSemanticAst[]): TaskCodeIndex {
  const occurrences: TaskCodeOccurrence[] = [];
  for (const ast of asts) {
    const seen = new Set<string>();
    const visit = (node: JspSemanticNode): void => {
      if ("sourceTag" in node && node.sourceTag) {
        const tag = node.sourceTag;
        if (tag.uri === TASK_URI && tag.name === "task" && tag.handlerClass) {
          const id = `${node.lineRange.startLine}:${node.lineRange.startColumn}`;
          if (!seen.has(id)) {
            seen.add(id);
            const value = tag.attributes.code;
            const state = value === undefined ? "missing" : value.trim() === "" ? "empty"
              : /(?:\$|#)\{/.test(value) ? "dynamic" : "literal";
            occurrences.push({
              file: ast.path,
              lineRange: tag.lineRange,
              prefix: tag.prefix,
              tagName: tag.name,
              uri: tag.uri,
              handlerClass: tag.handlerClass,
              raw: tag.raw,
              code: value,
              state,
              diagnostic: state === "missing" || state === "empty" ? "TASK code must have a value" : undefined
            });
          }
        }
      }
      for (const attribute of node.attributeNodes ?? []) visit(attribute);
      for (const child of node.children ?? []) visit(child);
    };
    visit(ast.root);
  }
  occurrences.sort((a, b) => a.file.localeCompare(b.file) || a.lineRange.startLine - b.lineRange.startLine ||
    a.lineRange.startColumn - b.lineRange.startColumn);
  const codes = [...new Set(occurrences.filter((row) => row.state === "literal").map((row) => row.code!))].sort();
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    occurrences,
    codes,
    counts: {
      occurrences: occurrences.length,
      literalOccurrences: occurrences.filter((row) => row.state === "literal").length,
      distinctCodes: codes.length,
      dynamicOccurrences: occurrences.filter((row) => row.state === "dynamic").length,
      invalidOccurrences: occurrences.filter((row) => row.state === "empty" || row.state === "missing").length
    }
  };
}

export async function writeTaskCodes(analysisOut: string, index: TaskCodeIndex): Promise<void> {
  const target = path.join(analysisOut, "index", "task-codes.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(index, null, 2));
}

export async function readTaskCodes(analysisOut: string, file?: string): Promise<TaskCodeIndex> {
  const index = JSON.parse(await fs.readFile(path.join(analysisOut, "index", "task-codes.json"), "utf8")) as TaskCodeIndex;
  if (!file) return index;
  const normalized = file.replace(/\\/g, "/");
  const occurrences = index.occurrences.filter((row) => row.file === normalized);
  const codes = [...new Set(occurrences.filter((row) => row.state === "literal").map((row) => row.code!))].sort();
  return {
    ...index,
    occurrences,
    codes,
    counts: {
      occurrences: occurrences.length,
      literalOccurrences: occurrences.filter((row) => row.state === "literal").length,
      distinctCodes: codes.length,
      dynamicOccurrences: occurrences.filter((row) => row.state === "dynamic").length,
      invalidOccurrences: occurrences.filter((row) => row.state === "empty" || row.state === "missing").length
    }
  };
}
