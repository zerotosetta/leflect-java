export type TaglibDirective = {
  prefix: string;
  uri: string;
};

export type JspTag = {
  prefix: string;
  name: string;
  raw: string;
};

export type ScriptletBlock = {
  kind: "scriptlet" | "expression" | "declaration";
  code: string;
};

export type JspParseResult = {
  taglibs: TaglibDirective[];
  tags: JspTag[];
  scriptlets: ScriptletBlock[];
};

const TAGLIB_REGEX = /<%@\s*taglib\s+([^%]*)%>/gi;
const ATTR_REGEX = /(\w+)\s*=\s*"([^"]+)"/g;
const TAG_REGEX = /<([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)(\s|>|\/)/g;
const SCRIPTLET_REGEX = /<%([\s\S]*?)%>/g;

export function parseJsp(content: string): JspParseResult {
  return {
    taglibs: extractTaglibs(content),
    tags: extractTags(content),
    scriptlets: extractScriptlets(content)
  };
}

function extractTaglibs(content: string): TaglibDirective[] {
  const directives: TaglibDirective[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAGLIB_REGEX.exec(content)) !== null) {
    const attrs = match[1];
    const record: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = ATTR_REGEX.exec(attrs)) !== null) {
      record[attrMatch[1]] = attrMatch[2];
    }
    if (record["prefix"] && record["uri"]) {
      directives.push({ prefix: record["prefix"], uri: record["uri"] });
    }
  }

  return directives;
}

function extractTags(content: string): JspTag[] {
  const tags: JspTag[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(content)) !== null) {
    tags.push({
      prefix: match[1],
      name: match[2],
      raw: match[0]
    });
  }

  return tags;
}

function extractScriptlets(content: string): ScriptletBlock[] {
  const blocks: ScriptletBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPTLET_REGEX.exec(content)) !== null) {
    const raw = match[0];
    const body = match[1];

    let kind: ScriptletBlock["kind"] = "scriptlet";
    if (raw.startsWith("<%=")) {
      kind = "expression";
    } else if (raw.startsWith("<%!")) {
      kind = "declaration";
    }

    blocks.push({ kind, code: body.trim() });
  }

  return blocks;
}
