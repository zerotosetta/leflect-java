import { writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { cleanupWorkspace, createFixtureWorkspace, exists, readJsonFile, resolveFixturePath } from "../index";

describe("testkit", () => {
  it("copies fixture directories into isolated workspaces", async () => {
    const fixturePath = resolveFixturePath("custom-tag");
    const workspace = await createFixtureWorkspace("custom-tag");

    try {
      expect(await exists(fixturePath)).toBe(true);
      expect(await exists(`${workspace.root}/src/UserService.java`)).toBe(true);
      expect(await exists(`${workspace.root}/web/customerEdit.jsp`)).toBe(true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });

  it("reads generated JSON artifacts", async () => {
    const workspace = await createFixtureWorkspace("custom-tag");

    try {
      const samplePath = `${workspace.root}/sample.json`;
      await writeFile(samplePath, JSON.stringify({ ok: true }));
      const payload = await readJsonFile<{ ok: boolean }>(samplePath);
      expect(payload.ok).toBe(true);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});
