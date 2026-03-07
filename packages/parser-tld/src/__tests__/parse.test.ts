import { describe, expect, it } from "vitest";

import { parseTld } from "../parse";

describe("parseTld", () => {
  it("extracts uri and tag handlers", () => {
    const xml = `<?xml version="1.0"?>
<taglib>
  <uri>http://example.com/tags</uri>
  <tag>
    <name>hello</name>
    <tag-class>com.example.HelloTag</tag-class>
  </tag>
</taglib>`;

    const result = parseTld(xml);

    expect(result.uri).toBe("http://example.com/tags");
    expect(result.tags).toEqual([
      { name: "hello", handlerClass: "com.example.HelloTag" }
    ]);
  });
});
