import { describe, expect, it } from "vitest";

import { buildJavaIndex } from "../java-index";
import { buildJspIndex } from "../jsp-index";
import { buildReverseIndex } from "../reverse-index";


describe("indexer", () => {
  it("builds java index from worker files", () => {
    const index = buildJavaIndex({
      files: ["src/com/example/Foo.java", "Bar.java"]
    });

    expect(index.classes).toEqual([
      { id: "Foo", name: "Foo", file: "src/com/example/Foo.java" },
      { id: "Bar", name: "Bar", file: "Bar.java" }
    ]);
  });

  it("builds jsp index", () => {
    const index = buildJspIndex([
      {
        path: "view/index.jsp",
        taglibs: [],
        tags: [],
        scriptlets: []
      }
    ]);

    expect(index.docs[0].path).toBe("view/index.jsp");
  });

  it("builds reverse index for tag handlers", () => {
    const index = buildReverseIndex([
      {
        prefix: "c",
        name: "hello",
        uri: "http://example.com/tags",
        handlerClass: "com.example.HelloTag",
        jspPath: "view/index.jsp"
      }
    ]);

    expect(index.handlerToJsp).toEqual({
      "com.example.HelloTag": ["view/index.jsp"]
    });
  });
});
