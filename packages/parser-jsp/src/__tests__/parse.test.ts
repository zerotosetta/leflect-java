import { describe, expect, it } from "vitest";

import { parseJsp } from "../parse";
import { resolveTagHandlers } from "../resolve";
import { TldIndex } from "@lefectjava/parser-tld";

describe("parseJsp", () => {
  it("extracts taglibs, tags, and scriptlets", () => {
    const jsp = `<%@ taglib prefix="c" uri="http://example.com/tags" %>\n` +
      `<c:hello />\n` +
      `<% int x = 1; %>`;

    const result = parseJsp(jsp);

    expect(result.taglibs).toEqual([
      { prefix: "c", uri: "http://example.com/tags" }
    ]);
    expect(result.tags[0].prefix).toBe("c");
    expect(result.tags[0].name).toBe("hello");
    expect(result.scriptlets[0].kind).toBe("scriptlet");
  });

  it("resolves tag handlers", () => {
    const jsp = `<%@ taglib prefix="c" uri="http://example.com/tags" %>\n<c:hello />`;
    const parsed = parseJsp(jsp);

    const tld: TldIndex = {
      uri: "http://example.com/tags",
      tags: [{ name: "hello", handlerClass: "com.example.HelloTag" }]
    };

    const resolved = resolveTagHandlers(parsed.tags, parsed.taglibs, [tld]);

    expect(resolved[0]).toEqual({
      prefix: "c",
      name: "hello",
      uri: "http://example.com/tags",
      handlerClass: "com.example.HelloTag"
    });
  });
});
