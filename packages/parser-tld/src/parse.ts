import { XMLParser } from "fast-xml-parser";

export type TldTag = {
  name: string;
  handlerClass?: string;
};

export type TldIndex = {
  uri?: string;
  tags: TldTag[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

export function parseTld(xml: string): TldIndex {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const taglib = (doc["taglib"] ?? doc["tag-lib"]) as Record<string, unknown> | undefined;

  if (!taglib || typeof taglib !== "object") {
    return { tags: [] };
  }

  const uri = typeof taglib["uri"] === "string" ? (taglib["uri"] as string) : undefined;
  const tagsNode = taglib["tag"];
  const tags = normalizeTags(tagsNode);

  return { uri, tags };
}

function normalizeTags(node: unknown): TldTag[] {
  if (!node) {
    return [];
  }

  const nodes = Array.isArray(node) ? node : [node];

  return nodes
    .map((item): TldTag | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record["name"] === "string" ? (record["name"] as string) : undefined;
      const handlerClass =
        typeof record["tag-class"] === "string" ? (record["tag-class"] as string) : undefined;
      if (!name) {
        return undefined;
      }
      return { name, handlerClass };
    })
    .filter((tag): tag is TldTag => tag !== undefined);
}
