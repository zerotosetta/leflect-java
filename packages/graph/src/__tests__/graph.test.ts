import os from "os";
import path from "path";
import { mkdtemp, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { buildGraphs, writeGraphFiles } from "../index";

describe("graph", () => {
  it("builds java and jsp graph edges", () => {
    const result = buildGraphs(
      [{ from: "a.A#run()", to: "b.B#save()" }],
      [
        {
          path: "view/index.jsp",
          scriptlets: [{ kind: "scriptlet", code: "new UserService().findUser();" }],
          resolvedTags: [{ prefix: "c", name: "form", handlerClass: "com.example.FormTag" }]
        }
      ],
      [{ id: "com.example.UserService", name: "UserService" }]
    );

    expect(result.javaCallEdges[0]).toEqual({
      from: "a.A#run()",
      to: "b.B#save()",
      type: "JAVA_CALL",
      confidence: "high"
    });
    expect(result.jspJavaEdges).toEqual([
      {
        from: "view/index.jsp",
        to: "com.example.UserService",
        type: "JSP_SCRIPTLET_CALL",
        confidence: "low"
      },
      {
        from: "view/index.jsp",
        to: "com.example.FormTag",
        type: "JSP_USES_TAG",
        confidence: "high"
      }
    ]);
  });

  it("writes graph jsonl files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "leflect-graph-"));

    await writeGraphFiles(root, {
      javaCallEdges: [{ from: "a", to: "b", type: "JAVA_CALL", confidence: "high" }],
      jspJavaEdges: [{ from: "jsp", to: "handler", type: "JSP_USES_TAG", confidence: "high" }]
    });

    const javaCall = await readFile(path.join(root, "graph", "java-call.jsonl"), "utf8");
    const jspJava = await readFile(path.join(root, "graph", "jsp-java.jsonl"), "utf8");

    expect(javaCall).toContain("\"JAVA_CALL\"");
    expect(jspJava).toContain("\"JSP_USES_TAG\"");
  });
});
