import { describe, expect, it } from "vitest";

import { createEntryRegistryManifest, createPluginManifest } from "../plugin-manifest";

describe("plugin manifest", () => {
  it("orders plugins by enforce and records hook metadata", () => {
    const manifest = createPluginManifest({
      root: "/repo",
      analysisOut: "/repo/analysis",
      plugins: [
        {
          name: "normal-plugin",
          hooks: [
            {
              id: "normal-hook",
              target: "java",
              when() {
                return true;
              },
              resolve() {
                return { matched: false };
              }
            }
          ]
        },
        {
          name: "pre-plugin",
          enforce: "pre",
          hooks: []
        },
        {
          name: "post-plugin",
          enforce: "post"
        }
      ]
    });

    expect(manifest.plugins.map((entry) => entry.name)).toEqual([
      "pre-plugin",
      "normal-plugin",
      "post-plugin"
    ]);
    expect(manifest.plugins[1]).toMatchObject({
      hookCount: 1,
      hooks: [{ id: "normal-hook", target: "java" }]
    });
  });

  it("records declared entries with seed counts", () => {
    const manifest = createEntryRegistryManifest({
      root: "/repo",
      analysisOut: "/repo/analysis",
      entries: [
        {
          id: "account.list",
          type: "virtual_page",
          jsp: ["view/account/list.jsp", "view/common/header.jsp"],
          java: ["src/main/java/com/example/AccountController.java"],
          query: ["account.selectBalance"],
          interfaceSpecs: ["IF_ACCOUNT_BALANCE"],
          variants: [{ id: "account.list.mobile", jsp: ["view/account/mobile.jsp"] }]
        }
      ]
    });

    expect(manifest.entries).toEqual([
      {
        id: "account.list",
        type: "virtual_page",
        jsp: ["view/account/list.jsp", "view/common/header.jsp"],
        java: ["src/main/java/com/example/AccountController.java"],
        query: ["account.selectBalance"],
        interfaceSpecs: ["IF_ACCOUNT_BALANCE"],
        variants: [{ id: "account.list.mobile", jsp: ["view/account/mobile.jsp"] }],
        variantCount: 1,
        seedCount: 5
      }
    ]);
  });
});
