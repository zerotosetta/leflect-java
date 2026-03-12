import fs from "fs/promises";
import path from "path";

export type PluginHookTarget = "java" | "jsp" | "common";

export type PluginScaffoldOptions = {
  root: string;
  name: string;
  target: PluginHookTarget;
  outputPath?: string;
  force: boolean;
  configPath?: string;
};

export type PluginScaffoldResult = {
  filePath: string;
  pluginName: string;
  factoryName: string;
  importPath?: string;
  configPath?: string;
};

export async function runPluginScaffoldCommand(
  options: PluginScaffoldOptions
): Promise<PluginScaffoldResult> {
  const pluginName = normalizePluginName(options.name);
  const outputPath = options.outputPath
    ? path.resolve(options.root, options.outputPath)
    : path.join(options.root, "leflect", "plugins", `${pluginName}.ts`);
  const factoryName = toFactoryName(pluginName);

  if ((await fileExists(outputPath)) && !options.force) {
    throw new Error(
      `Plugin scaffold already exists at ${outputPath}. Re-run with '--force' to overwrite it.`
    );
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    renderPluginScaffold({
      pluginName,
      factoryName,
      target: options.target
    }),
    "utf8"
  );

  const result: PluginScaffoldResult = {
    filePath: outputPath,
    pluginName,
    factoryName,
    configPath: options.configPath
  };

  if (options.configPath?.endsWith(".ts")) {
    result.importPath = toImportSpecifier(path.dirname(options.configPath), outputPath);
  }

  return result;
}

export function renderPluginScaffold(input: {
  pluginName: string;
  factoryName: string;
  target: PluginHookTarget;
}): string {
  const humanLabel = input.pluginName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return [
    "import type { LeflectPlugin } from \"@leflect-java/schema\";",
    "",
    `export function ${input.factoryName}(): LeflectPlugin {`,
    "  return {",
    `    name: \"${input.pluginName}\",`,
    "    enforce: \"normal\",",
    "    hooks: [",
    "      {",
    `        id: \"${input.pluginName}-hook\",`,
    `        target: \"${input.target}\",`,
    "        when(node) {",
    "          void node;",
    "          return false;",
    "        },",
    "        resolve(node, ctx) {",
    "          void node;",
    "          ctx.logger.info(\"Plugin scaffold placeholder executed\", {",
    `            plugin: \"${input.pluginName}\",`,
    `            hook: \"${input.pluginName}-hook\"`,
    "          });",
    "          return {",
    "            matched: false,",
    "            diagnostics: [",
    `              \"${humanLabel} resolver scaffold is present but not implemented yet.\"`,
    "            ]",
    "          };",
    "        }",
    "      }",
    "    ]",
    "  };",
    "}",
    ""
  ].join("\n");
}

function normalizePluginName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!normalized) {
    throw new Error("Option '--name' must contain at least one letter or number");
  }

  return normalized.endsWith("-plugin") ? normalized : `${normalized}-plugin`;
}

function toFactoryName(pluginName: string): string {
  const withoutSuffix = pluginName.endsWith("-plugin")
    ? pluginName.slice(0, -"-plugin".length)
    : pluginName;
  const parts = withoutSuffix.split("-").filter(Boolean);
  const base = parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("");
  return `${base || "custom"}Plugin`;
}

function toImportSpecifier(configDir: string, targetFile: string): string {
  const relative = path.relative(configDir, targetFile);
  const withoutExt = relative.replace(/\.[^.]+$/, "");
  const normalized = withoutExt.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
