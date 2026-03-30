import { describe, expect, it } from "vitest";

import { parseJsp } from "@leflect-java/parser-jsp";

import { buildJspIndex } from "../jsp-index";
import { buildJspSemanticAsts } from "../jsp-semantic";
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
            code: "new CustomerService().findCustomer(name);",
            location: { line: 4, column: 4, endLine: 4, endColumn: 43 },
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
    ], {
      javaMethods: [
        {
          id: "com.example.CustomerService#findCustomer(java.lang.String)",
          name: "findCustomer",
          classId: "com.example.CustomerService",
          file: "src/main/java/com/example/CustomerService.java",
          returnType: "com.example.Customer",
          parameters: ["java.lang.String"]
        }
      ]
    });

    expect(index.files[0]).toMatchObject({
      path: "view/index.jsp",
      taglibCount: 1,
      tagCount: 1,
      scriptletCount: 1,
      resolvedTagCount: 1
    });
    expect(index.imports).toEqual([
      {
        id: "jsp-import:view/index.jsp:com.example.CustomerService",
        file: "view/index.jsp",
        import: "com.example.CustomerService",
        simpleName: "CustomerService",
        location: { line: 1, column: 34, endLine: 1, endColumn: 60 }
      },
      {
        id: "jsp-import:view/index.jsp:java.util.List",
        file: "view/index.jsp",
        import: "java.util.List",
        simpleName: "List",
        location: { line: 1, column: 18, endLine: 1, endColumn: 31 }
      }
    ]);
    expect(index.classReferences).toHaveLength(4);
    expect(index.classReferences).toEqual(expect.arrayContaining([
      {
        file: "view/index.jsp",
        className: "com.example.CustomerService",
        classPath: "com.example.CustomerService",
        importId: "jsp-import:view/index.jsp:com.example.CustomerService",
        kind: "import",
        location: { line: 1, column: 34, endLine: 1, endColumn: 60 },
        snippet: "com.example.CustomerService"
      },
      {
        file: "view/index.jsp",
        className: "com.example.HelloTag",
        classPath: "com.example.HelloTag",
        importId: undefined,
        kind: "tag-handler",
        location: { line: 3, column: 1, endLine: 3, endColumn: 8 },
        snippet: "<c:hello ",
        uri: "http://example.com/tags",
        handlerClass: "com.example.HelloTag"
      },
      {
        file: "view/index.jsp",
        className: "java.util.List",
        classPath: "java.util.List",
        importId: "jsp-import:view/index.jsp:java.util.List",
        kind: "import",
        location: { line: 1, column: 18, endLine: 1, endColumn: 31 },
        snippet: "java.util.List"
      },
      {
        file: "view/index.jsp",
        className: "CustomerService",
        classPath: "com.example.CustomerService",
        importId: "jsp-import:view/index.jsp:com.example.CustomerService",
        kind: "scriptlet",
        location: { line: 4, column: 8, endLine: 4, endColumn: 22 },
        snippet: "new CustomerService("
      }
    ]));
    expect(index.methodCalls).toEqual([
      {
        file: "view/index.jsp",
        methodName: "findCustomer",
        methodId: "com.example.CustomerService#findCustomer(java.lang.String)",
        qualifier: undefined,
        classPath: "com.example.CustomerService",
        importId: "jsp-import:view/index.jsp:com.example.CustomerService",
        inputParameters: [
          {
            index: 0,
            type: "java.lang.String",
            value: "name"
          }
        ],
        responseType: "com.example.Customer",
        location: { line: 4, column: 26, endLine: 4, endColumn: 37 },
        snippet: "findCustomer(name)"
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
        sourceKind: undefined,
        prefixes: ["c"],
        jspFiles: ["view/index.jsp"],
        tags: [
          {
            name: "hello",
            handlerClass: "com.example.HelloTag",
            attributes: undefined,
            bodyContent: undefined,
            dynamicAttributes: undefined,
            jspFiles: ["view/index.jsp"]
          }
        ]
      }
    ]);
  });

  it("builds semantic asts and supports custom tag resolvers", async () => {
    const parsed = parseJsp([
      `<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>`,
      `<%@ taglib prefix="sql" uri="http://java.sun.com/jsp/jstl/sql" %>`,
      `<%@ taglib prefix="my" uri="http://example.com/custom" %>`,
      `<c:if test="\${user != null}">`,
      `  <sql:query var="accounts">select * from account</sql:query>`,
      `  <my:query id="account.find">`,
      `    select * from account where id = \${accountId}`,
      `  </my:query>`,
      `</c:if>`
    ].join("\n"));

    const docs = [{
      path: "view/index.jsp",
      ...parsed,
      resolvedTags: [
        { prefix: "c", name: "if", uri: "http://java.sun.com/jsp/jstl/core" },
        { prefix: "sql", name: "query", uri: "http://java.sun.com/jsp/jstl/sql" },
        { prefix: "my", name: "query", uri: "http://example.com/custom", handlerClass: "com.example.QueryTag" }
      ]
    }];
    const jspIndex = buildJspIndex(docs);
    const semanticAsts = await buildJspSemanticAsts({
      projectRoot: "/repo",
      analysisOut: "/repo/analysis",
      astMode: "lightweight",
      docs,
      files: jspIndex.files.map((file) => ({
        ...file,
        importEntries: jspIndex.imports.filter((entry) => entry.file === file.path),
        taglibs: jspIndex.taglibs.filter((entry) => entry.file === file.path),
        tags: jspIndex.tags.filter((entry) => entry.file === file.path),
        scriptlets: jspIndex.scriptlets.filter((entry) => entry.file === file.path),
        classReferences: jspIndex.classReferences.filter((entry) => entry.file === file.path),
        methodCalls: jspIndex.methodCalls.filter((entry) => entry.file === file.path)
      })),
      registry: [
        {
          uri: "http://example.com/custom",
          sourcePath: "WEB-INF/custom.tld",
          sourceKind: "repo",
          tags: [
            {
              name: "query",
              handlerClass: "com.example.QueryTag"
            }
          ]
        }
      ],
      taglibResolvers: {
        "http://example.com/custom#query": ({ tag }) => ({
          kind: "QueryNode",
          raw: tag.raw,
          lineRange: tag.lineRange,
          queryId: tag.attributes["id"],
          statement: tag.bodyText,
          sourceTag: tag
        })
      }
    });

    expect(semanticAsts).toHaveLength(1);
    expect(semanticAsts[0].semanticSummary).toMatchObject({
      controlCount: 1,
      queryCount: 2
    });
    expect(semanticAsts[0].root.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "IfStatement",
        children: expect.arrayContaining([
          expect.objectContaining({
            kind: "QueryNode",
            queryId: "accounts"
          }),
          expect.objectContaining({
            kind: "QueryNode",
            queryId: "account.find",
            sourceTag: expect.objectContaining({
              handlerClass: "com.example.QueryTag"
            })
          })
        ])
      })
    ]));
  });

  it("marks JSTL tags as standard even without an explicit taglib directive", () => {
    const index = buildJspIndex([
      {
        path: "view/legacy.jsp",
        directives: [],
        imports: [],
        includes: ["common/kfsTldHeader.jsp"],
        taglibs: [],
        tags: [
          {
            prefix: "c",
            name: "if",
            raw: "<c:if ",
            location: { line: 1, column: 1, endLine: 1, endColumn: 6 }
          },
          {
            prefix: "fmt",
            name: "message",
            raw: "<fmt:message ",
            location: { line: 2, column: 1, endLine: 2, endColumn: 13 }
          },
          {
            prefix: "app",
            name: "widget",
            raw: "<app:widget ",
            location: { line: 3, column: 1, endLine: 3, endColumn: 12 }
          }
        ],
        scriptlets: []
      }
    ]);

    expect(index.tags).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "view/legacy.jsp",
        prefix: "c",
        name: "if",
        uri: "http://java.sun.com/jsp/jstl/core"
      }),
      expect.objectContaining({
        file: "view/legacy.jsp",
        prefix: "fmt",
        name: "message",
        uri: "http://java.sun.com/jsp/jstl/fmt"
      }),
      expect.objectContaining({
        file: "view/legacy.jsp",
        prefix: "app",
        name: "widget",
        uri: undefined
      })
    ]));
    expect(index.docs[0].resolvedTags).toEqual([
      {
        prefix: "c",
        name: "if",
        uri: "http://java.sun.com/jsp/jstl/core",
        handlerClass: undefined
      },
      {
        prefix: "fmt",
        name: "message",
        uri: "http://java.sun.com/jsp/jstl/fmt",
        handlerClass: undefined
      }
    ]);
  });
});
