import { describe, expect, it } from "vitest";

import { buildJspIndex } from "../jsp-index";
import { buildReverseIndex } from "../reverse-index";
import { buildTaglibIndex } from "../taglib-index";

describe("indexer", () => {
  it("builds jsp metadata indexes with locations", () => {
    const index = buildJspIndex([
      {
        path: "view/index.jsp",
        directives: [
          {
            kind: "page",
            attributes: {
              import: "java.util.List, com.example.CustomerService"
            },
            raw: '<%@ page import="java.util.List, com.example.CustomerService" %>',
            location: { line: 1, column: 1, endLine: 1, endColumn: 63 }
          },
          {
            kind: "taglib",
            attributes: {
              prefix: "c",
              uri: "http://example.com/tags"
            },
            raw: '<%@ taglib prefix="c" uri="http://example.com/tags" %>',
            location: { line: 2, column: 1, endLine: 2, endColumn: 56 }
          }
        ],
        imports: ["com.example.CustomerService", "java.util.List"],
        includes: [],
        taglibs: [
          {
            prefix: "c",
            uri: "http://example.com/tags",
            location: { line: 2, column: 1, endLine: 2, endColumn: 56 }
          }
        ],
        tags: [
          {
            prefix: "c",
            name: "hello",
            raw: "<c:hello ",
            location: { line: 3, column: 1, endLine: 3, endColumn: 8 }
          }
        ],
        scriptlets: [
          {
            kind: "scriptlet",
            code: "new CustomerService().findCustomer();",
            location: { line: 4, column: 4, endLine: 4, endColumn: 39 },
            codeOffset: 0
          }
        ],
        resolvedTags: [
          {
            prefix: "c",
            name: "hello",
            uri: "http://example.com/tags",
            handlerClass: "com.example.HelloTag"
          }
        ]
      }
    ]);

    expect(index.files[0]).toMatchObject({
      path: "view/index.jsp",
      taglibCount: 1,
      tagCount: 1,
      scriptletCount: 1,
      resolvedTagCount: 1
    });
    expect(index.imports).toEqual([
      {
        file: "view/index.jsp",
        import: "com.example.CustomerService",
        location: { line: 1, column: 34, endLine: 1, endColumn: 60 }
      },
      {
        file: "view/index.jsp",
        import: "java.util.List",
        location: { line: 1, column: 18, endLine: 1, endColumn: 31 }
      }
    ]);
    expect(index.classReferences).toHaveLength(4);
    expect(index.classReferences).toEqual(expect.arrayContaining([
      {
        file: "view/index.jsp",
        className: "com.example.CustomerService",
        kind: "import",
        location: { line: 1, column: 34, endLine: 1, endColumn: 60 },
        snippet: "com.example.CustomerService"
      },
      {
        file: "view/index.jsp",
        className: "com.example.HelloTag",
        kind: "tag-handler",
        location: { line: 3, column: 1, endLine: 3, endColumn: 8 },
        snippet: "<c:hello ",
        uri: "http://example.com/tags",
        handlerClass: "com.example.HelloTag"
      },
      {
        file: "view/index.jsp",
        className: "java.util.List",
        kind: "import",
        location: { line: 1, column: 18, endLine: 1, endColumn: 31 },
        snippet: "java.util.List"
      },
      {
        file: "view/index.jsp",
        className: "CustomerService",
        kind: "scriptlet",
        location: { line: 4, column: 8, endLine: 4, endColumn: 22 },
        snippet: "new CustomerService("
      }
    ]));
    expect(index.methodCalls).toEqual([
      {
        file: "view/index.jsp",
        methodName: "findCustomer",
        qualifier: undefined,
        location: { line: 4, column: 26, endLine: 4, endColumn: 37 },
        snippet: "findCustomer("
      }
    ]);
  });

  it("builds reverse and taglib indexes from jsp/java metadata", () => {
    const reverseIndex = buildReverseIndex({
      resolvedTags: [
        {
          prefix: "c",
          name: "hello",
          uri: "http://example.com/tags",
          handlerClass: "com.example.HelloTag",
          jspPath: "view/index.jsp"
        }
      ],
      jspDocs: [
        {
          path: "view/index.jsp",
          directives: [],
          imports: [],
          includes: [],
          taglibs: [{ prefix: "c", uri: "http://example.com/tags", location: { line: 1, column: 1, endLine: 1, endColumn: 10 } }],
          tags: [{ prefix: "c", name: "hello", raw: "<c:hello ", location: { line: 2, column: 1, endLine: 2, endColumn: 8 } }],
          scriptlets: []
        }
      ],
      classes: [
        { id: "com.example.HelloTag", name: "HelloTag", file: "src/HelloTag.java" }
      ],
      calls: [
        { fromClassId: "com.example.Controller", toClassId: "com.example.HelloTag", fromFile: "src/Controller.java" }
      ]
    });
    const taglibIndex = buildTaglibIndex(
      [
        {
          uri: "http://example.com/tags",
          sourcePath: "WEB-INF/example.tld",
          tags: [{ name: "hello", handlerClass: "com.example.HelloTag" }]
        }
      ],
      [
        {
          path: "view/index.jsp",
          directives: [],
          imports: [],
          includes: [],
          taglibs: [{ prefix: "c", uri: "http://example.com/tags", location: { line: 1, column: 1, endLine: 1, endColumn: 10 } }],
          tags: [{ prefix: "c", name: "hello", raw: "<c:hello ", location: { line: 2, column: 1, endLine: 2, endColumn: 8 } }],
          scriptlets: [],
          resolvedTags: [
            {
              prefix: "c",
              name: "hello",
              uri: "http://example.com/tags",
              handlerClass: "com.example.HelloTag"
            }
          ]
        }
      ]
    );

    expect(reverseIndex).toEqual({
      handlerToJsp: {
        "com.example.HelloTag": ["view/index.jsp"]
      },
      taglibUriToJsp: {
        "http://example.com/tags": ["view/index.jsp"]
      },
      tagToJsp: {
        "c:hello": ["view/index.jsp"]
      },
      classToFiles: {
        "com.example.HelloTag": ["src/HelloTag.java"]
      },
      fileToClasses: {
        "src/HelloTag.java": ["com.example.HelloTag"]
      },
      classCallers: {
        "com.example.HelloTag": ["com.example.Controller"]
      }
    });
    expect(taglibIndex.taglibs).toEqual([
      {
        uri: "http://example.com/tags",
        sourcePath: "WEB-INF/example.tld",
        prefixes: ["c"],
        jspFiles: ["view/index.jsp"],
        tags: [
          {
            name: "hello",
            handlerClass: "com.example.HelloTag",
            jspFiles: ["view/index.jsp"]
          }
        ]
      }
    ]);
  });
});
