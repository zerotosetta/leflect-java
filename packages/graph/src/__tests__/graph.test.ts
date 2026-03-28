import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildGraphs, writeGraphFiles } from "../index";

describe("graph", () => {
  it("builds java and jsp graph edges", () => {
    const result = buildGraphs(
      [{
        from: "a.A#run()",
        to: "b.B#save()",
        fromClassId: "a.A",
        toClassId: "b.B",
        fromMethodId: "a.A#run()",
        toMethodId: "b.B#save()",
        fromFile: "src/a/A.java"
      }],
      [
        {
          path: "view/index.jsp",
          scriptlets: [{ kind: "scriptlet", code: "new UserService().findUser();" }],
          resolvedTags: [
            { prefix: "c", name: "if", uri: "http://java.sun.com/jsp/jstl/core" },
            { prefix: "c", name: "form", handlerClass: "com.example.FormTag" }
          ]
        }
      ],
      [
        { id: "a.A", name: "A", file: "src/a/A.java" },
        { id: "b.B", name: "B", file: "src/b/B.java" },
        { id: "com.example.UserService", name: "UserService", file: "src/service/UserService.java" },
        { id: "com.example.FormTag", name: "FormTag", file: "src/tag/FormTag.java" }
      ],
      {
        entryFiles: {
          java: ["A\\.java$"],
          jsp: ["index\\.jsp$"]
        },
        entries: [
          {
            id: "account.list",
            type: "virtual_page",
            label: "Account List",
            description: "A virtual page seed with fan-out JSPs plus deferred query and interface targets.",
            jsp: ["view/index.jsp"],
            java: ["src/a/A.java"],
            query: ["account.selectBalance"],
            interfaceSpecs: ["IF_ACCOUNT_BALANCE"],
            tags: ["legacy", "account"],
            variants: [
              {
                id: "account.list.mobile",
                label: "Account List Mobile",
                jsp: ["view/index.jsp"],
                tags: ["mobile"]
              }
            ]
          }
        ]
      }
    );

    expect(result.javaCallEdges[0]).toEqual({
      from: "a.A",
      to: "b.B",
      type: "JAVA_CALL",
      confidence: "high",
      fromFile: "src/a/A.java",
      toFile: "src/b/B.java",
      fromSymbol: "a.A#run()",
      toSymbol: "b.B#save()"
    });
    expect(result.jspJavaEdges).toEqual([
      {
        from: "view/index.jsp",
        to: "com.example.UserService",
        type: "JSP_SCRIPTLET_CALL",
        confidence: "low",
        fromFile: "view/index.jsp",
        toFile: "src/service/UserService.java",
        toSymbol: "com.example.UserService"
      },
      {
        from: "view/index.jsp",
        to: "com.example.FormTag",
        type: "JSP_USES_TAG",
        confidence: "high",
        fromFile: "view/index.jsp",
        toFile: "src/tag/FormTag.java",
        toSymbol: "com.example.FormTag"
      }
    ]);
    expect(result.fileDependencies.files).toEqual([
      {
        path: "src/a/A.java",
        nodeType: "java",
        referenceCount: 1,
        dependantCount: 0,
        references: [
          {
            path: "src/b/B.java",
            nodeType: "java",
            edgeTypes: ["JAVA_CALL"],
            symbols: ["b.B#save()"]
          }
        ],
        referencedBy: []
      },
      {
        path: "src/b/B.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "src/a/A.java",
            nodeType: "java",
            edgeTypes: ["JAVA_CALL"],
            symbols: ["a.A#run()"]
          }
        ]
      },
      {
        path: "src/service/UserService.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "view/index.jsp",
            nodeType: "jsp",
            edgeTypes: ["JSP_SCRIPTLET_CALL"],
            symbols: ["view/index.jsp"]
          }
        ]
      },
      {
        path: "src/tag/FormTag.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "view/index.jsp",
            nodeType: "jsp",
            edgeTypes: ["JSP_USES_TAG"],
            symbols: ["view/index.jsp"]
          }
        ]
      },
      {
        path: "view/index.jsp",
        nodeType: "jsp",
        referenceCount: 2,
        dependantCount: 0,
        references: [
          {
            path: "src/service/UserService.java",
            nodeType: "java",
            edgeTypes: ["JSP_SCRIPTLET_CALL"],
            symbols: ["com.example.UserService"]
          },
          {
            path: "src/tag/FormTag.java",
            nodeType: "java",
            edgeTypes: ["JSP_USES_TAG"],
            symbols: ["com.example.FormTag"]
          }
        ],
        referencedBy: []
      }
    ]);
    expect(result.entryDependencies.matchedEntries).toEqual([
      {
        path: "src/a/A.java",
        nodeType: "java",
        matchedBy: ["A\\.java$"]
      },
      {
        path: "view/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"]
      }
    ]);
    expect(result.entryDependencies.entries).toEqual([
      {
        entry: "src/a/A.java",
        nodeType: "java",
        matchedBy: ["A\\.java$"],
        nodeCount: 2,
        edgeCount: 1,
        reachableFiles: ["src/a/A.java", "src/b/B.java"],
        edges: [
          {
            from: "src/a/A.java",
            to: "src/b/B.java",
            type: "JAVA_CALL",
            confidence: "high",
            fromFile: "src/a/A.java",
            toFile: "src/b/B.java",
            fromSymbol: "a.A#run()",
            toSymbol: "b.B#save()"
          }
        ]
      },
      {
        entry: "view/index.jsp",
        nodeType: "jsp",
        matchedBy: ["index\\.jsp$"],
        nodeCount: 3,
        edgeCount: 2,
        reachableFiles: ["src/service/UserService.java", "src/tag/FormTag.java", "view/index.jsp"],
        edges: [
          {
            from: "view/index.jsp",
            to: "src/service/UserService.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "low",
            fromFile: "view/index.jsp",
            toFile: "src/service/UserService.java",
            toSymbol: "com.example.UserService"
          },
          {
            from: "view/index.jsp",
            to: "src/tag/FormTag.java",
            type: "JSP_USES_TAG",
            confidence: "high",
            fromFile: "view/index.jsp",
            toFile: "src/tag/FormTag.java",
            toSymbol: "com.example.FormTag"
          }
        ]
      }
    ]);
    expect(result.entryDependencies.declaredEntries).toEqual([
      {
        id: "account.list",
        type: "virtual_page",
        label: "Account List",
        description: "A virtual page seed with fan-out JSPs plus deferred query and interface targets.",
        tags: ["legacy", "account"],
        seeds: {
          java: [
            {
              targetType: "java",
              value: "src/a/A.java",
              matched: true,
              path: "src/a/A.java",
              nodeType: "java"
            }
          ],
          jsp: [
            {
              targetType: "jsp",
              value: "view/index.jsp",
              matched: true,
              path: "view/index.jsp",
              nodeType: "jsp"
            }
          ]
        },
        deferredTargets: [
          {
            targetType: "query",
            value: "account.selectBalance",
            reason: "graph-model-pending"
          },
          {
            targetType: "interface",
            value: "IF_ACCOUNT_BALANCE",
            reason: "graph-model-pending"
          }
        ],
        nodeCount: 5,
        edgeCount: 3,
        reachableFiles: [
          "src/a/A.java",
          "src/b/B.java",
          "src/service/UserService.java",
          "src/tag/FormTag.java",
          "view/index.jsp"
        ],
        edges: [
          {
            from: "src/a/A.java",
            to: "src/b/B.java",
            type: "JAVA_CALL",
            confidence: "high",
            fromFile: "src/a/A.java",
            toFile: "src/b/B.java",
            fromSymbol: "a.A#run()",
            toSymbol: "b.B#save()"
          },
          {
            from: "view/index.jsp",
            to: "src/service/UserService.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "low",
            fromFile: "view/index.jsp",
            toFile: "src/service/UserService.java",
            toSymbol: "com.example.UserService"
          },
          {
            from: "view/index.jsp",
            to: "src/tag/FormTag.java",
            type: "JSP_USES_TAG",
            confidence: "high",
            fromFile: "view/index.jsp",
            toFile: "src/tag/FormTag.java",
            toSymbol: "com.example.FormTag"
          }
        ]
      },
      {
        id: "account.list.mobile",
        type: "virtual_page",
        label: "Account List Mobile",
        description: "A virtual page seed with fan-out JSPs plus deferred query and interface targets.",
        tags: ["legacy", "account", "mobile"],
        variantOf: "account.list",
        seeds: {
          java: [
            {
              targetType: "java",
              value: "src/a/A.java",
              matched: true,
              path: "src/a/A.java",
              nodeType: "java"
            }
          ],
          jsp: [
            {
              targetType: "jsp",
              value: "view/index.jsp",
              matched: true,
              path: "view/index.jsp",
              nodeType: "jsp"
            }
          ]
        },
        deferredTargets: [
          {
            targetType: "query",
            value: "account.selectBalance",
            reason: "graph-model-pending"
          },
          {
            targetType: "interface",
            value: "IF_ACCOUNT_BALANCE",
            reason: "graph-model-pending"
          }
        ],
        nodeCount: 5,
        edgeCount: 3,
        reachableFiles: [
          "src/a/A.java",
          "src/b/B.java",
          "src/service/UserService.java",
          "src/tag/FormTag.java",
          "view/index.jsp"
        ],
        edges: [
          {
            from: "src/a/A.java",
            to: "src/b/B.java",
            type: "JAVA_CALL",
            confidence: "high",
            fromFile: "src/a/A.java",
            toFile: "src/b/B.java",
            fromSymbol: "a.A#run()",
            toSymbol: "b.B#save()"
          },
          {
            from: "view/index.jsp",
            to: "src/service/UserService.java",
            type: "JSP_SCRIPTLET_CALL",
            confidence: "low",
            fromFile: "view/index.jsp",
            toFile: "src/service/UserService.java",
            toSymbol: "com.example.UserService"
          },
          {
            from: "view/index.jsp",
            to: "src/tag/FormTag.java",
            type: "JSP_USES_TAG",
            confidence: "high",
            fromFile: "view/index.jsp",
            toFile: "src/tag/FormTag.java",
            toSymbol: "com.example.FormTag"
          }
        ]
      }
    ]);
  });

  it("skips JSTL tags but keeps unresolved custom tags", () => {
    const result = buildGraphs(
      [],
      [
        {
          path: "view/index.jsp",
          scriptlets: [],
          resolvedTags: [
            { prefix: "c", name: "if", uri: "http://java.sun.com/jsp/jstl/core" },
            { prefix: "fmt", name: "formatNumber", uri: "jakarta.tags.fmt" },
            { prefix: "app", name: "widget", uri: "/WEB-INF/app.tld" }
          ]
        }
      ],
      []
    );

    expect(result.jspJavaEdges).toHaveLength(1);
    expect(result.jspJavaEdges[0]).toMatchObject({
      from: "view/index.jsp",
      to: "unresolved:tag:app:widget",
      type: "JSP_USES_TAG",
      confidence: "unresolved",
      fromFile: "view/index.jsp"
    });
  });

  it("skips JSTL tags in raw tag fallback mode", () => {
    const result = buildGraphs(
      [],
      [
        {
          path: "view/legacy.jsp",
          scriptlets: [],
          tags: [
            { prefix: "c", name: "if" },
            { prefix: "fmt", name: "message" },
            { prefix: "app", name: "widget" }
          ]
        }
      ],
      []
    );

    expect(result.jspJavaEdges).toEqual([
      {
        from: "view/legacy.jsp",
        to: "unresolved:tag:app:widget:2",
        type: "JSP_USES_TAG",
        confidence: "unresolved",
        fromFile: "view/legacy.jsp"
      }
    ]);
  });

  it("builds local java import edges into file dependencies", () => {
    const result = buildGraphs(
      [],
      [],
      [
        { id: "org.example.Constants", name: "Constants", file: "src/main/java/org/example/Constants.java" },
        { id: "org.example.App", name: "App", file: "src/main/java/org/example/App.java" }
      ],
      {
        javaClassReferences: [
          {
            file: "src/main/java/org/example/App.java",
            className: "org.example.Constants",
            qualifiedName: "org.example.Constants",
            classPath: "org.example.Constants",
            kind: "import",
            snippet: "import org.example.Constants;"
          },
          {
            file: "src/main/java/org/example/App.java",
            className: "java.util.List",
            qualifiedName: "java.util.List",
            classPath: "java.util.List",
            kind: "import",
            snippet: "import java.util.List;"
          }
        ]
      }
    );

    expect(result.javaImportEdges).toEqual([
      {
        from: "src/main/java/org/example/App.java",
        to: "java.util.List",
        type: "JAVA_IMPORT",
        confidence: "high",
        fromFile: "src/main/java/org/example/App.java",
        fromSymbol: "import java.util.List;",
        toSymbol: "java.util.List"
      },
      {
        from: "src/main/java/org/example/App.java",
        to: "org.example.Constants",
        type: "JAVA_IMPORT",
        confidence: "high",
        fromFile: "src/main/java/org/example/App.java",
        toFile: "src/main/java/org/example/Constants.java",
        fromSymbol: "import org.example.Constants;",
        toSymbol: "org.example.Constants"
      }
    ]);
    expect(result.fileDependencies.files).toEqual([
      {
        path: "src/main/java/org/example/App.java",
        nodeType: "java",
        referenceCount: 2,
        dependantCount: 0,
        references: [
          {
            path: "java.util.List",
            nodeType: "unresolved",
            edgeTypes: ["JAVA_IMPORT"],
            symbols: ["java.util.List"]
          },
          {
            path: "src/main/java/org/example/Constants.java",
            nodeType: "java",
            edgeTypes: ["JAVA_IMPORT"],
            symbols: ["org.example.Constants"]
          }
        ],
        referencedBy: []
      },
      {
        path: "src/main/java/org/example/Constants.java",
        nodeType: "java",
        referenceCount: 0,
        dependantCount: 1,
        references: [],
        referencedBy: [
          {
            path: "src/main/java/org/example/App.java",
            nodeType: "java",
            edgeTypes: ["JAVA_IMPORT"],
            symbols: ["import org.example.Constants;"]
          }
        ]
      }
    ]);
  });

  it("builds external imports and type/new references into dependency edges", () => {
    const result = buildGraphs(
      [],
      [],
      [
        { id: "org.example.App", name: "App", file: "src/main/java/org/example/App.java" }
      ],
      {
        javaClassReferences: [
          {
            file: "src/main/java/org/example/App.java",
            className: "java.util.List",
            qualifiedName: "java.util.List",
            classPath: "java.util.List",
            kind: "import",
            snippet: "import java.util.List;"
          },
          {
            file: "src/main/java/org/example/App.java",
            className: "IOException",
            qualifiedName: "java.io.IOException",
            classPath: "java.io.IOException",
            kind: "type",
            snippet: "IOException"
          },
          {
            file: "src/main/java/org/example/App.java",
            className: "ArrayList",
            qualifiedName: "java.util.ArrayList<java.lang.String>",
            classPath: "java.util.ArrayList<java.lang.String>",
            kind: "new",
            snippet: "new ArrayList<String>()"
          },
          {
            file: "src/main/java/org/example/App.java",
            className: "log4j",
            qualifiedName: "org.apache.log4j",
            classPath: "org.apache.log4j",
            kind: "type",
            snippet: "org.apache.log4j"
          }
        ]
      }
    );

    expect(result.javaImportEdges).toEqual([
      {
        from: "src/main/java/org/example/App.java",
        to: "java.util.List",
        type: "JAVA_IMPORT",
        confidence: "high",
        fromFile: "src/main/java/org/example/App.java",
        fromSymbol: "import java.util.List;",
        toSymbol: "java.util.List"
      }
    ]);
    expect(result.javaTypeReferenceEdges).toEqual([
      {
        from: "src/main/java/org/example/App.java",
        to: "java.io.IOException",
        type: "JAVA_TYPE_REFERENCE",
        confidence: "high",
        fromFile: "src/main/java/org/example/App.java",
        fromSymbol: "IOException",
        toSymbol: "java.io.IOException"
      }
    ]);
    expect(result.javaNewEdges).toEqual([
      {
        from: "src/main/java/org/example/App.java",
        to: "java.util.ArrayList",
        type: "JAVA_NEW",
        confidence: "high",
        fromFile: "src/main/java/org/example/App.java",
        fromSymbol: "new ArrayList<String>()",
        toSymbol: "java.util.ArrayList"
      }
    ]);
    expect(result.fileDependencies.files).toEqual([
      {
        path: "src/main/java/org/example/App.java",
        nodeType: "java",
        referenceCount: 3,
        dependantCount: 0,
        references: [
          {
            path: "java.io.IOException",
            nodeType: "unresolved",
            edgeTypes: ["JAVA_TYPE_REFERENCE"],
            symbols: ["java.io.IOException"]
          },
          {
            path: "java.util.ArrayList",
            nodeType: "unresolved",
            edgeTypes: ["JAVA_NEW"],
            symbols: ["java.util.ArrayList"]
          },
          {
            path: "java.util.List",
            nodeType: "unresolved",
            edgeTypes: ["JAVA_IMPORT"],
            symbols: ["java.util.List"]
          }
        ],
        referencedBy: []
      }
    ]);
  });

  it("writes graph jsonl files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-graph-"));

    await writeGraphFiles(root, {
      javaCallEdges: [{ from: "a", to: "b", type: "JAVA_CALL", confidence: "high" }],
      javaImportEdges: [{ from: "src/A.java", to: "demo.B", type: "JAVA_IMPORT", confidence: "high" }],
      javaTypeReferenceEdges: [{ from: "src/A.java", to: "java.util.List", type: "JAVA_TYPE_REFERENCE", confidence: "high" }],
      javaNewEdges: [{ from: "src/A.java", to: "java.util.ArrayList", type: "JAVA_NEW", confidence: "high" }],
      jspJavaEdges: [{ from: "jsp", to: "handler", type: "JSP_USES_TAG", confidence: "high" }],
      fileEdges: [{ from: "src/A.java", to: "src/B.java", type: "JAVA_CALL", confidence: "high" }],
      fileDependencies: {
        schemaVersion: "1.0",
        generatedAt: "2026-03-08T00:00:00.000Z",
        files: []
      },
      entryDependencies: {
        schemaVersion: "1.0",
        generatedAt: "2026-03-08T00:00:00.000Z",
        patterns: { java: [], jsp: [] },
        matchedEntries: [],
        unmatchedPatterns: [],
        entries: [],
        declaredEntries: []
      }
    });

    const javaCall = await readFile(path.join(root, "graph", "java-call.jsonl"), "utf8");
    const javaImport = await readFile(path.join(root, "graph", "java-import.jsonl"), "utf8");
    const javaTypeReference = await readFile(path.join(root, "graph", "java-type-reference.jsonl"), "utf8");
    const javaNew = await readFile(path.join(root, "graph", "java-new.jsonl"), "utf8");
    const jspJava = await readFile(path.join(root, "graph", "jsp-java.jsonl"), "utf8");
    const fileDependency = await readFile(path.join(root, "graph", "file-dependency.jsonl"), "utf8");
    const fileDependencies = await readFile(path.join(root, "graph", "file-dependencies.json"), "utf8");
    const entryDependencies = await readFile(path.join(root, "graph", "entry-dependencies.json"), "utf8");

    expect(javaCall).toContain("\"JAVA_CALL\"");
    expect(javaImport).toContain("\"JAVA_IMPORT\"");
    expect(javaTypeReference).toContain("\"JAVA_TYPE_REFERENCE\"");
    expect(javaNew).toContain("\"JAVA_NEW\"");
    expect(jspJava).toContain("\"JSP_USES_TAG\"");
    expect(fileDependency).toContain("\"src/A.java\"");
    expect(fileDependencies).toContain("\"schemaVersion\": \"1.0\"");
    expect(entryDependencies).toContain("\"patterns\"");
  });
});
