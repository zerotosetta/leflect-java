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
          types: [
            {
              name: "App",
              fqn: "demo.App",
              extendsTypes: ["BaseApp"],
              implementsTypes: ["Runnable"],
              methods: [
                {
                  id: "demo.App#run()",
                  name: "run",
                  calls: ["demo.Service#work()", "helper"]
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
        extendsTypes: ["BaseApp"],
        implementsTypes: ["Runnable"]
      }
    ]);
    expect(index.methods).toEqual([
      {
        id: "demo.App#run()",
        name: "run",
        classId: "demo.App",
        file: "src/main/java/demo/App.java"
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
        fromFile: "src/main/java/demo/App.java"
      },
      {
        from: "demo.App#run()",
        to: "unresolved:java-call:demo.App#run():helper",
        fromClassId: "demo.App",
        toClassId: undefined,
        fromMethodId: "demo.App#run()",
        toMethodId: undefined,
        fromFile: "src/main/java/demo/App.java"
      }
    ]);
  });
});
