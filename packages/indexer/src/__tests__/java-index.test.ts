import { describe, expect, it } from "vitest";

import { buildJavaIndex } from "../java-index";

describe("buildJavaIndex", () => {
  it("builds classes, methods, and calls from java-summary output", () => {
    const index = buildJavaIndex({
      files: ["src/main/java/demo/App.java"],
      summaries: [
        {
          path: "src/main/java/demo/App.java",
          packageName: "demo",
          imports: ["demo.Service"],
          classReferences: [
            {
              symbol: "demo.Service",
              qualifiedName: "demo.Service",
              kind: "import",
              location: {
                line: 1,
                column: 1,
                endLine: 1,
                endColumn: 19
              },
              snippet: "import demo.Service;"
            },
            {
              symbol: "Service",
              qualifiedName: "demo.Service",
              kind: "type",
              location: {
                line: 3,
                column: 9,
                endLine: 3,
                endColumn: 15
              },
              snippet: "Service"
            }
          ],
          methodCalls: [
            {
              callerMethodId: "demo.App#run()",
              callerClassId: "demo.App",
              target: "demo.Service#work()",
              targetClassId: "demo.Service",
              targetMethodId: "demo.Service#work()",
              targetMethodName: "work",
              classPath: "demo.Service",
              parameterTypes: ["java.lang.String"],
              argumentExpressions: ["name"],
              responseType: "java.lang.String",
              location: {
                line: 3,
                column: 19,
                endLine: 3,
                endColumn: 24
              },
              snippet: "work()"
            },
            {
              callerMethodId: "demo.App#run()",
              callerClassId: "demo.App",
              target: "helper",
              location: {
                line: 4,
                column: 5,
                endLine: 4,
                endColumn: 10
              },
              snippet: "helper()"
            }
          ],
          types: [
            {
              name: "App",
              fqn: "demo.App",
              extendsTypes: ["BaseApp"],
              implementsTypes: ["Runnable"],
              location: {
                line: 1,
                column: 1,
                endLine: 6,
                endColumn: 1
              },
              methods: [
                {
                  id: "demo.App#run()",
                  name: "run",
                  calls: ["demo.Service#work()", "helper"],
                  location: {
                    line: 2,
                    column: 3,
                    endLine: 5,
                    endColumn: 3
                  }
                }
              ]
            }
          ]
        }
      ]
    });

    expect(index.classes).toEqual([
      {
        id: "demo.App",
        name: "App",
        file: "src/main/java/demo/App.java",
        packageName: "demo",
        sourceKind: undefined,
        extendsTypes: ["BaseApp"],
        implementsTypes: ["Runnable"],
        kind: undefined,
        location: {
          line: 1,
          column: 1,
          endLine: 6,
          endColumn: 1
        }
      }
    ]);
    expect(index.methods).toEqual([
      {
        id: "demo.App#run()",
        name: "run",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        returnType: undefined,
        parameters: [],
        callTargets: ["demo.Service#work()", "helper"],
        location: {
          line: 2,
          column: 3,
          endLine: 5,
          endColumn: 3
        }
      }
    ]);
    expect(index.calls).toEqual([
      {
        from: "demo.App#run()",
        to: "demo.Service",
        fromClassId: "demo.App",
        toClassId: "demo.Service",
        fromMethodId: "demo.App#run()",
        toMethodId: "demo.Service#work()",
        fromFile: "src/main/java/demo/App.java",
        toFile: undefined,
        rawTarget: "demo.Service#work()",
        methodName: "work",
        classPath: "demo.Service",
        importId: "java-import:src/main/java/demo/App.java:demo.Service",
        inputParameters: [
          {
            index: 0,
            type: "java.lang.String",
            value: "name"
          }
        ],
        responseType: "java.lang.String",
        location: {
          line: 3,
          column: 19,
          endLine: 3,
          endColumn: 24
        },
        snippet: "work()"
      },
      {
        from: "demo.App#run()",
        to: "unresolved:java-call:demo.App#run():helper",
        fromClassId: "demo.App",
        toClassId: undefined,
        fromMethodId: "demo.App#run()",
        toMethodId: undefined,
        fromFile: "src/main/java/demo/App.java",
        toFile: undefined,
        rawTarget: "helper",
        methodName: "helper",
        classPath: undefined,
        importId: undefined,
        inputParameters: undefined,
        responseType: undefined,
        location: {
          line: 4,
          column: 5,
          endLine: 4,
          endColumn: 10
        },
        snippet: "helper()"
      }
    ]);
    expect(index.classReferences).toEqual([
      {
        file: "src/main/java/demo/App.java",
        className: "demo.Service",
        qualifiedName: "demo.Service",
        classPath: "demo.Service",
        importId: "java-import:src/main/java/demo/App.java:demo.Service",
        kind: "import",
        location: {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 19
        },
        snippet: "import demo.Service;"
      },
      {
        file: "src/main/java/demo/App.java",
        className: "Service",
        qualifiedName: "demo.Service",
        classPath: "demo.Service",
        importId: "java-import:src/main/java/demo/App.java:demo.Service",
        kind: "type",
        location: {
          line: 3,
          column: 9,
          endLine: 3,
          endColumn: 15
        },
        snippet: "Service"
      }
    ]);
    expect(index.imports).toEqual([
      {
        id: "java-import:src/main/java/demo/App.java:demo.Service",
        file: "src/main/java/demo/App.java",
        import: "demo.Service",
        simpleName: "Service",
        location: {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 19
        }
      }
    ]);
  });
});
