import fs from "fs/promises";
import path from "path";

import {
  LeflectConfig,
  LeflectEntryDefinition,
  LeflectPlugin,
  LeflectPluginEnforce
} from "@leflect-java/schema";

const SCHEMA_VERSION = "1.0";

export type PluginManifestHookRecord = {
  id: string;
  target: string;
};

export type PluginManifestRecord = {
  name: string;
  enforce: LeflectPluginEnforce;
  version?: string;
  order: number;
  hookCount: number;
  hooks: PluginManifestHookRecord[];
};

export type PluginManifest = {
  schemaVersion: string;
  generatedAt: string;
  plugins: PluginManifestRecord[];
};

export type EntryRegistryManifestRecord = LeflectEntryDefinition & {
  variantCount: number;
  seedCount: number;
};

export type EntryRegistryManifest = {
  schemaVersion: string;
  generatedAt: string;
  entries: EntryRegistryManifestRecord[];
};

export function orderPlugins(plugins: LeflectPlugin[] = []): LeflectPlugin[] {
  return [...plugins]
    .map((plugin, index) => ({ plugin, index }))
    .sort((left, right) => {
      const enforceDelta = enforceWeight(left.plugin.enforce) - enforceWeight(right.plugin.enforce);
      if (enforceDelta !== 0) {
        return enforceDelta;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.plugin);
}

export function createPluginManifest(config: LeflectConfig): PluginManifest {
  const orderedPlugins = orderPlugins(config.plugins ?? []);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    plugins: orderedPlugins.map((plugin, index) => ({
      name: plugin.name,
      enforce: plugin.enforce ?? "normal",
      version: plugin.version,
      order: index,
      hookCount: plugin.hooks?.length ?? 0,
      hooks: (plugin.hooks ?? []).map((hook) => ({
        id: hook.id,
        target: hook.target
      }))
    }))
  };
}

export function createEntryRegistryManifest(config: LeflectConfig): EntryRegistryManifest {
  const entries = config.entries ?? [];

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      ...entry,
      variantCount: entry.variants?.length ?? 0,
      seedCount:
        (entry.jsp?.length ?? 0) +
        (entry.java?.length ?? 0) +
        (entry.query?.length ?? 0) +
        (entry.interfaceSpecs?.length ?? 0)
    }))
  };
}

export async function writeConfigRegistryArtifacts(config: LeflectConfig): Promise<void> {
  const manifestDir = path.join(config.analysisOut, "manifests");
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(
    path.join(manifestDir, "plugins.json"),
    JSON.stringify(createPluginManifest(config), null, 2)
  );
  await fs.writeFile(
    path.join(manifestDir, "entries.json"),
    JSON.stringify(createEntryRegistryManifest(config), null, 2)
  );
}

function enforceWeight(value?: LeflectPluginEnforce): number {
  switch (value) {
    case "pre":
      return 0;
    case "post":
      return 2;
    default:
      return 1;
  }
}
