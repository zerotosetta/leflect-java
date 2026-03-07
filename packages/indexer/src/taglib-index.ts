import fs from "fs/promises";
import path from "path";

import { TldIndex } from "@lefectjava/parser-tld";

export type TaglibIndex = {
  taglibs: TldIndex[];
};

export function buildTaglibIndex(taglibs: TldIndex[]): TaglibIndex {
  return { taglibs };
}

export async function writeTaglibIndex(outDir: string, index: TaglibIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "taglibs.json"),
    JSON.stringify(index.taglibs, null, 2)
  );
}
