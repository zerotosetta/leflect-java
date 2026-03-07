import { describe, expect, it } from "vitest";

import { buildJavaCommand } from "../index";

describe("buildJavaCommand", () => {
  it("builds java -jar command", () => {
    const result = buildJavaCommand({
      jarPath: "/tmp/worker.jar",
      args: ["parse-java", "--manifest", "manifest.json"]
    });

    expect(result.command).toBe("java");
    expect(result.args).toEqual([
      "-jar",
      "/tmp/worker.jar",
      "parse-java",
      "--manifest",
      "manifest.json"
    ]);
  });
});
