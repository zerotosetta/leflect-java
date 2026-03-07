import { JspTag, TaglibDirective } from "./parse";
import { TldIndex } from "@lefectjava/parser-tld";

export type ResolvedTag = {
  prefix: string;
  name: string;
  uri?: string;
  handlerClass?: string;
};

export function resolveTagHandlers(
  tags: JspTag[],
  taglibs: TaglibDirective[],
  tldIndexes: TldIndex[]
): ResolvedTag[] {
  const taglibMap = new Map<string, string>();
  for (const taglib of taglibs) {
    taglibMap.set(taglib.prefix, taglib.uri);
  }

  return tags.map((tag) => {
    const uri = taglibMap.get(tag.prefix);
    const tld = uri ? tldIndexes.find((index) => index.uri === uri) : undefined;
    const handler = tld?.tags.find((entry) => entry.name === tag.name)?.handlerClass;

    return {
      prefix: tag.prefix,
      name: tag.name,
      uri,
      handlerClass: handler
    };
  });
}
