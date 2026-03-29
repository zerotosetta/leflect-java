import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildJavaIndex, writeJavaIndex } from "../java-index";

describe("buildJavaIndex", () => {
  it("builds classes, methods, fields, and calls from java-summary output", () => {
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
              name: "Service",
              qualifiedName: "demo.Service",
              resolvedClassId: "demo.Service",
              kind: "import",
              location: {
                line: 1,
                column: 1,
                endLine: 1,
                endColumn: 19
              },
              lineRange: {
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 19
              },
              snippet: "import demo.Service;"
            },
            {
              symbol: "Service",
              name: "Service",
              qualifiedName: "demo.Service",
              resolvedClassId: "demo.Service",
              kind: "type",
              location: {
                line: 3,
                column: 9,
                endLine: 3,
                endColumn: 15
              },
              lineRange: {
                startLine: 3,
                startColumn: 9,
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
              targetText: "service.work",
              targetClassId: "demo.Service",
              resolvedClassId: "demo.Service",
              targetMethodId: "demo.Service#work()",
              resolvedMethodId: "demo.Service#work()",
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
              lineRange: {
                startLine: 3,
                startColumn: 19,
                endLine: 3,
                endColumn: 24
              },
              snippet: "work()"
            },
            {
              callerMethodId: "demo.App#run()",
              callerClassId: "demo.App",
              target: "helper",
              targetText: "helper",
              location: {
                line: 4,
                column: 5,
                endLine: 4,
                endColumn: 10
              },
              lineRange: {
                startLine: 4,
                startColumn: 5,
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
              fields: [
                {
                  id: "demo.App#service",
                  name: "service",
                  declaredType: "demo.Service",
                  type: "demo.Service",
                  modifiers: ["private", "final"],
                  lifetime: "instance",
                  initializerSnippet: "new Service()",
                  location: {
                    line: 2,
                    column: 3,
                    endLine: 2,
                    endColumn: 25
                  },
                  lineRange: {
                    startLine: 2,
                    startColumn: 3,
                    endLine: 2,
                    endColumn: 25
                  }
                },
                {
                  id: "demo.App#INSTANCE",
                  name: "INSTANCE",
                  declaredType: "demo.App",
                  type: "demo.App",
                  modifiers: ["static"],
                  lifetime: "class",
                  location: {
                    line: 3,
                    column: 3,
                    endLine: 3,
                    endColumn: 19
                  },
                  lineRange: {
                    startLine: 3,
                    startColumn: 3,
                    endLine: 3,
                    endColumn: 19
                  }
                }
              ],
              location: {
                line: 1,
                column: 1,
                endLine: 6,
                endColumn: 1
              },
              lineRange: {
                startLine: 1,
                startColumn: 1,
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
                  },
                  lineRange: {
                    startLine: 2,
                    startColumn: 3,
                    endLine: 5,
                    endColumn: 3
                  },
                  orderedSteps: [
                    {
                      id: "demo.App#run():step:1",
                      kind: "call",
                      snippet: "service.work(name)",
                      branchPath: [],
                      lineRange: {
                        startLine: 3,
                        startColumn: 5,
                        endLine: 3,
                        endColumn: 22
                      },
                      call: {
                        targetText: "service.work",
                        resolvedMethodId: "demo.Service#work()",
                        resolvedClassId: "demo.Service",
                        methodName: "work"
                      }
                    }
                  ]
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
        kind: undefined,
        extendsTypes: ["BaseApp"],
        implementsTypes: ["Runnable"],
        location: {
          line: 1,
          column: 1,
          endLine: 6,
          endColumn: 1
        },
        lineRange: {
          startLine: 1,
          startColumn: 1,
          endLine: 6,
          endColumn: 1
        }
      }
    ]);
    expect(index.fields).toEqual([
      {
        id: "demo.App#INSTANCE",
        name: "INSTANCE",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        declaredType: "demo.App",
        type: "demo.App",
        modifiers: ["static"],
        lifetime: "class",
        initializerSnippet: undefined,
        location: {
          line: 3,
          column: 3,
          endLine: 3,
          endColumn: 19
        },
        lineRange: {
          startLine: 3,
          startColumn: 3,
          endLine: 3,
          endColumn: 19
        }
      },
      {
        id: "demo.App#service",
        name: "service",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        declaredType: "demo.Service",
        type: "demo.Service",
        modifiers: ["private", "final"],
        lifetime: "instance",
        initializerSnippet: "new Service()",
        location: {
          line: 2,
          column: 3,
          endLine: 2,
          endColumn: 25
        },
        lineRange: {
          startLine: 2,
          startColumn: 3,
          endLine: 2,
          endColumn: 25
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
        },
        lineRange: {
          startLine: 2,
          startColumn: 3,
          endLine: 5,
          endColumn: 3
        },
        orderedSteps: [
          {
            id: "demo.App#run():step:1",
            kind: "call",
            snippet: "service.work(name)",
            branchPath: [],
            lineRange: {
              startLine: 3,
              startColumn: 5,
              endLine: 3,
              endColumn: 22
            },
            call: {
              targetText: "service.work",
              resolvedMethodId: "demo.Service#work()",
              resolvedClassId: "demo.Service",
              methodName: "work"
            }
          }
        ]
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
        targetText: "service.work",
        methodName: "work",
        classPath: "demo.Service",
        resolvedClassId: "demo.Service",
        resolvedMethodId: "demo.Service#work()",
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
        lineRange: {
          startLine: 3,
          startColumn: 19,
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
        targetText: "helper",
        methodName: "helper",
        classPath: undefined,
        resolvedClassId: undefined,
        resolvedMethodId: undefined,
        importId: undefined,
        inputParameters: undefined,
        responseType: undefined,
        location: {
          line: 4,
          column: 5,
          endLine: 4,
          endColumn: 10
        },
        lineRange: {
          startLine: 4,
          startColumn: 5,
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
        name: "Service",
        qualifiedName: "demo.Service",
        classPath: "demo.Service",
        resolvedClassId: "demo.Service",
        importId: "java-import:src/main/java/demo/App.java:demo.Service",
        kind: "import",
        location: {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 19
        },
        lineRange: {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 19
        },
        snippet: "import demo.Service;"
      },
      {
        file: "src/main/java/demo/App.java",
        className: "Service",
        name: "Service",
        qualifiedName: "demo.Service",
        classPath: "demo.Service",
        resolvedClassId: "demo.Service",
        importId: "java-import:src/main/java/demo/App.java:demo.Service",
        kind: "type",
        location: {
          line: 3,
          column: 9,
          endLine: 3,
          endColumn: 15
        },
        lineRange: {
          startLine: 3,
          startColumn: 9,
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

  it("writes field metadata, ordered steps, and field counts to sharded output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-java-index-"));
    const index = buildJavaIndex({
      files: ["src/main/java/demo/App.java"],
      summaries: [
        {
          path: "src/main/java/demo/App.java",
          packageName: "demo",
          types: [
            {
              name: "App",
              fqn: "demo.App",
              fields: [
                {
                  id: "demo.App#name",
                  name: "name",
                  declaredType: "String",
                  type: "String",
                  modifiers: [],
                  lifetime: "instance",
                  initializerSnippet: "\"demo\""
                },
                {
                  id: "demo.App#counter",
                  name: "counter",
                  declaredType: "int",
                  type: "int",
                  modifiers: ["static", "final"],
                  lifetime: "class"
                }
              ],
              methods: [
                {
                  id: "demo.App#run()",
                  name: "run",
                  orderedSteps: [
                    {
                      id: "demo.App#run():step:1",
                      kind: "branch",
                      branchPath: [],
                      snippet: "if (ready) { work(); }",
                      lineRange: {
                        startLine: 4,
                        startColumn: 5,
                        endLine: 4,
                        endColumn: 24
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    await writeJavaIndex(root, index);

    const manifest = JSON.parse(
      await readFile(path.join(root, "java-files.json"), "utf8")
    ) as Array<{ path: string; fieldCount?: number; metadataPath?: string }>;
    const metadataPath = manifest[0]?.metadataPath;
    const metadata = JSON.parse(
      await readFile(path.join(root, metadataPath ?? ""), "utf8")
    ) as {
      fields?: Array<{ id: string; type?: string; initializerSnippet?: string }>;
      methods?: Array<{ id: string; orderedSteps?: Array<{ id: string; kind: string }> }>;
    };

    expect(manifest).toEqual([
      {
        path: "src/main/java/demo/App.java",
        sourceKind: undefined,
        packageName: "demo",
        metadataPath: "java/src/main/java/demo/App.java.json",
        importCount: 0,
        classCount: 1,
        fieldCount: 2,
        methodCount: 1,
        callCount: 0,
        classReferenceCount: 0
      }
    ]);
    expect(metadata.fields).toEqual([
      {
        id: "demo.App#counter",
        name: "counter",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        declaredType: "int",
        type: "int",
        modifiers: ["static", "final"],
        lifetime: "class",
        initializerSnippet: undefined,
        location: undefined,
        lineRange: undefined
      },
      {
        id: "demo.App#name",
        name: "name",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        declaredType: "String",
        type: "String",
        modifiers: [],
        lifetime: "instance",
        initializerSnippet: "\"demo\"",
        location: undefined,
        lineRange: undefined
      }
    ]);
    expect(metadata.methods).toEqual([
      {
        id: "demo.App#run()",
        name: "run",
        classId: "demo.App",
        file: "src/main/java/demo/App.java",
        returnType: undefined,
        parameters: [],
        callTargets: [],
        location: undefined,
        lineRange: undefined,
        orderedSteps: [
          {
            id: "demo.App#run():step:1",
            kind: "branch",
            snippet: "if (ready) { work(); }",
            branchPath: [],
            lineRange: {
              startLine: 4,
              startColumn: 5,
              endLine: 4,
              endColumn: 24
            },
            call: undefined
          }
        ]
      }
    ]);
  });
});
