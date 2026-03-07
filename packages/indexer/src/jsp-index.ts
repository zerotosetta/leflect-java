import fs from "fs/promises";
import path from "path";

import { JspParseResult } from "@lefectjava/parser-jsp";

export type JspDocIndexEntry = JspParseResult & {
  path: string;
};

export type JspIndex = {
  docs: JspDocIndexEntry[];
};

export function buildJspIndex(entries: JspDocIndexEntry[]): JspIndex {
  return { docs: entries };
}

export async function writeJspIndex(outDir: string, index: JspIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "jsp-docs.json"),
    JSON.stringify(index.docs, null, 2)
  );
}
