import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { JavaExecutionModel } from "@leflect-java/schema";
import { buildJavaIndex, flattenJavaFileMetadata, readJavaFileMetadataDir, writeJavaIndex } from "../java-index";

describe("versioned Java execution contract", () => {
  it("round-trips the v2 model and partial call types without replacing legacy facts", async () => {
    const model: JavaExecutionModel = {
      version: 2, orderedSteps: [{ id: "declaration:1", kind: "variable-declaration" }],
      flowGraph: { entryNodeId: "entry", exitNodeIds: ["exit"], nodes: [{ id: "entry" }, { id: "exit" }], edges: [{ from: "entry", to: "exit" }] },
      symbols: [{ id: "scoped:x" }], states: [{ nodeId: "entry", before: {}, after: {} }],
      coverage: { status: "complete", sourceScope: "explicit-source" }
    };
    const index = buildJavaIndex({ files: ["Example.java"], summaries: [{
      path: "Example.java", types: [{ fqn: "Example", name: "Example", methods: [{
        id: "Example#run()", name: "run", orderedSteps: [{ id: "legacy:1", kind: "assignment" }], executionModel: model
      }] }], methodCalls: [{ callerMethodId: "Example#run()", target: "Other#value()", responseType: "T",
        declaredReturnType: "T", expressionType: "T", expressionTypeStatus: "partial", expressionTypeReason: "Unbound type variable" }]
    }] });
    const out = await mkdtemp(path.join(os.tmpdir(), "leflect-execution-contract-"));
    await writeJavaIndex(out, index);
    const restored = flattenJavaFileMetadata(await readJavaFileMetadataDir(out));
    expect(restored.methods[0].executionModel).toEqual(model);
    expect(restored.methods[0].orderedSteps?.[0].id).toBe("legacy:1");
    expect(restored.calls[0]).toMatchObject({ responseType: "T", declaredReturnType: "T", expressionType: "T", expressionTypeStatus: "partial" });
  });
});
