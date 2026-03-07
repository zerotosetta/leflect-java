import { describe, expect, it } from "vitest";

import { buildStageIncrementalPlan, createCacheKey, createStageCacheState } from "../cache";

describe("cache", () => {
  it("selects only changed files when cache keys match", () => {
    const cacheKey = createCacheKey({ stage: "java-parse", version: "0.1.0" });
    const previousState = createStageCacheState(
      "java-parse",
      cacheKey,
      ["src/A.java", "src/B.java"],
      {
        "src/A.java": { hash: "sha1:a", type: "java", size: 1, mtimeMs: 1 },
        "src/B.java": { hash: "sha1:b", type: "java", size: 1, mtimeMs: 1 }
      }
    );

    const plan = buildStageIncrementalPlan(
      ["src/A.java", "src/B.java", "src/C.java"],
      {
        "src/A.java": { hash: "sha1:a", type: "java", size: 1, mtimeMs: 1 },
        "src/B.java": { hash: "sha1:b2", type: "java", size: 1, mtimeMs: 1 },
        "src/C.java": { hash: "sha1:c", type: "java", size: 1, mtimeMs: 1 }
      },
      previousState,
      cacheKey
    );

    expect(plan.reason).toBe("changed");
    expect(plan.selectedFiles).toEqual(["src/B.java", "src/C.java"]);
    expect(plan.unchangedFiles).toEqual(["src/A.java"]);
  });

  it("invalidates all files when cache key changes", () => {
    const previousKey = createCacheKey({ stage: "jsp-parse", version: "0.1.0" });
    const nextKey = createCacheKey({ stage: "jsp-parse", version: "0.2.0" });
    const previousState = createStageCacheState(
      "jsp-parse",
      previousKey,
      ["web/index.jsp"],
      {
        "web/index.jsp": { hash: "sha1:a", type: "jsp", size: 1, mtimeMs: 1 }
      }
    );

    const plan = buildStageIncrementalPlan(
      ["web/index.jsp"],
      {
        "web/index.jsp": { hash: "sha1:a", type: "jsp", size: 1, mtimeMs: 1 }
      },
      previousState,
      nextKey
    );

    expect(plan.reason).toBe("invalidated");
    expect(plan.selectedFiles).toEqual(["web/index.jsp"]);
  });
});
