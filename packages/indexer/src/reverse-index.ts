import fs from "fs/promises";
import path from "path";

import { ResolvedTag } from "@lefectjava/parser-jsp";

export type ReverseIndex = {
  handlerToJsp: Record<string, string[]>;
};

export function buildReverseIndex(
  resolvedTags: Array<ResolvedTag & { jspPath: string }>
): ReverseIndex {
  const map: Record<string, Set<string>> = {};

  for (const tag of resolvedTags) {
    if (!tag.handlerClass) {
      continue;
    }
    if (!map[tag.handlerClass]) {
      map[tag.handlerClass] = new Set();
    }
    map[tag.handlerClass].add(tag.jspPath);
  }

  const handlerToJsp: Record<string, string[]> = {};
  for (const [handler, paths] of Object.entries(map)) {
    handlerToJsp[handler] = Array.from(paths);
  }

  return { handlerToJsp };
}

export async function writeReverseIndex(outDir: string, index: ReverseIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "reverse-index.json"),
    JSON.stringify(index, null, 2)
  );
}
