import path from "path";

import { TldRegistryEntry, TldRegistryTag } from "@leflect-java/schema";

import { JspTag, SourceLocation, TaglibDirective } from "./parse";
import { createJspWebResourceResolver } from "./static-taglibs";

export type ResolvedTag = {
  prefix: string;
  name: string;
  uri?: string;
  handlerClass?: string;
  tagFile?: string;
  location?: SourceLocation;
  unresolvedReason?: string;
};

const JSTL_PREFIXES = new Set(["c", "fmt", "fn", "sql", "x"]);
const JSTL_URI = /^(?:https?:\/\/(?:java\.sun\.com|xmlns\.jcp\.org)\/jsp\/jstl\/|jakarta\.tags\.)(?:core|fmt|functions|sql|xml)$/;

export async function resolveTagFiles(
  root: string,
  webappRoot: string,
  tlds: TldRegistryEntry[]
): Promise<Map<TldRegistryTag, string>> {
  const resources = createJspWebResourceResolver(root, webappRoot);
  const files = new Map<TldRegistryTag, string>();
  for (const tld of tlds) {
    if (tld.sourcePath?.includes("!/")) {
      continue;
    }
    for (const tag of tld.tags) {
      if (!tag.tagFilePath || !/\.tagx?$/i.test(tag.tagFilePath)) {
        continue;
      }
      const absolute = await resources.resolve(tag.tagFilePath);
      if (absolute) {
        const projectPath = resources.projectPath(absolute);
        if (projectPath !== ".." && !projectPath.startsWith("../") && !path.isAbsolute(projectPath)) {
          files.set(tag, projectPath);
        }
      }
    }
  }
  return files;
}

export function resolveTagHandlers(
  tags: JspTag[],
  taglibs: TaglibDirective[],
  tldIndexes: TldRegistryEntry[],
  tagFiles?: ReadonlyMap<TldRegistryTag, string>
): ResolvedTag[] {
  const taglibMap = new Map(taglibs.map((taglib) => [taglib.prefix, taglib.uri]));

  return tags.map((tag) => {
    const uri = taglibMap.get(tag.prefix);
    const tld = uri ? tldIndexes.find((entry) => entry.uri === uri) : undefined;
    const declaration = tld?.tags.find((entry) => entry.name === tag.name);
    const tagFile = declaration && tagFiles?.get(declaration);
    let unresolvedReason: string | undefined;
    if (declaration?.tagFilePath && !tagFile) {
      unresolvedReason = `Tag file target unavailable: ${declaration.tagFilePath}`;
    } else if (
      tag.prefix !== "jsp" &&
      !(uri ? JSTL_URI.test(uri) : JSTL_PREFIXES.has(tag.prefix)) &&
      !declaration?.handlerClass &&
      !tagFile
    ) {
      if (!uri) {
        unresolvedReason = `Missing taglib declaration for prefix ${tag.prefix}`;
      } else if (!tld) {
        unresolvedReason = `No TLD found for ${uri}`;
      } else {
        unresolvedReason = `No target declared for ${tag.prefix}:${tag.name} in ${uri}`;
      }
    }

    return {
      prefix: tag.prefix,
      name: tag.name,
      uri,
      handlerClass: declaration?.handlerClass,
      location: tag.location,
      ...(tagFile ? { tagFile } : {}),
      ...(unresolvedReason ? { unresolvedReason } : {})
    };
  });
}
