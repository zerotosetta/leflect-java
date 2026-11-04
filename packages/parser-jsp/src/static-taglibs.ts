import fs from "fs/promises";
import path from "path";

import { JspDirective, parseJsp, SourceLocation, TaglibDirective } from "./parse";

type JspSource = { path: string; directives: JspDirective[] };
type IncludeDiagnostic = {
  code: "missing-include" | "include-cycle" | "conflicting-prefix";
  page: string;
  sourcePath: string;
  target: string;
  location: SourceLocation;
};
type EffectiveTaglib = TaglibDirective & { sourcePath?: string };

export function createJspWebResourceResolver(projectRoot: string, webappRoot: string) {
  const root = path.resolve(projectRoot, webappRoot);
  const realRoot = fs.realpath(root).catch(() => undefined);
  const resources = new Map<string, Promise<string | undefined>>();

  function candidate(target: string, relativeTo: string): string | undefined {
    if (!target || /[\\:\u0000?#]/.test(target)) {
      return undefined;
    }
    const absolute = target.startsWith("/")
      ? path.resolve(root, target.replace(/^\/+/, ""))
      : path.resolve(relativeTo, target);
    return isInside(root, absolute) ? absolute : undefined;
  }

  return {
    async resolve(target: string, relativeTo = root): Promise<string | undefined> {
      const absolute = candidate(target, relativeTo);
      if (!absolute) {
        return undefined;
      }
      let resource = resources.get(absolute);
      if (!resource) {
        resource = realRoot.then(async (boundary) => {
          if (!boundary) {
            return undefined;
          }
          try {
            const actual = await fs.realpath(absolute);
            return isInside(boundary, actual) && (await fs.stat(actual)).isFile() ? actual : undefined;
          } catch {
            return undefined;
          }
        });
        resources.set(absolute, resource);
      }
      return resource;
    },
    webPath(target: string, relativeTo: string): string | undefined {
      const absolute = candidate(target, relativeTo);
      return absolute ? `/${path.relative(root, absolute).split(path.sep).join("/")}` : undefined;
    },
    projectPath(absolute: string): string {
      return path.relative(projectRoot, absolute).split(path.sep).join("/");
    }
  };
}

export function createStaticTaglibResolver(projectRoot: string, webappRoot: string) {
  const resources = createJspWebResourceResolver(projectRoot, webappRoot);
  const fragments = new Map<string, Promise<JspDirective[] | undefined>>();

  function readDirectives(absolute: string): Promise<JspDirective[] | undefined> {
    let result = fragments.get(absolute);
    if (!result) {
      result = fs.readFile(absolute, "utf8").then((content) => parseJsp(content).directives, () => undefined);
      fragments.set(absolute, result);
    }
    return result;
  }

  return async (page: JspSource): Promise<{
    taglibs: EffectiveTaglib[];
    diagnostics: IncludeDiagnostic[];
    includePaths: string[];
  }> => {
    const diagnostics: IncludeDiagnostic[] = [];
    const taglibs = new Map<string, EffectiveTaglib>();
    const conflicts = new Set<string>();
    const pageFile = path.resolve(projectRoot, page.path);
    const active = new Set<string>([await fs.realpath(pageFile).catch(() => pageFile)]);
    const visited = new Set<string>();
    const includePaths = new Set<string>();

    async function visit(source: JspSource, absolute: string): Promise<void> {
      for (const directive of source.directives) {
        if (directive.kind === "taglib") {
          const { prefix, uri } = directive.attributes;
          if (!prefix || !uri || conflicts.has(prefix)) {
            continue;
          }
          const previous = taglibs.get(prefix);
          if (previous && previous.uri !== uri) {
            conflicts.add(prefix);
            taglibs.delete(prefix);
            diagnostics.push({
              code: "conflicting-prefix", page: page.path, sourcePath: source.path,
              target: prefix, location: directive.location
            });
          } else if (!previous) {
            taglibs.set(prefix, { prefix, uri, location: directive.location, sourcePath: source.path });
          }
          continue;
        }
        if (directive.kind !== "include") {
          continue;
        }
        const target = directive.attributes.file?.trim() ?? "";
        const webPath = resources.webPath(target, path.dirname(absolute));
        if (webPath) {
          includePaths.add(webPath);
        }
        const include = webPath ? await resources.resolve(webPath) : undefined;
        const context = { page: page.path, sourcePath: source.path, target, location: directive.location };
        if (!include) {
          diagnostics.push({ code: "missing-include", ...context });
          continue;
        }
        if (active.has(include)) {
          diagnostics.push({ code: "include-cycle", ...context });
          continue;
        }
        if (visited.has(include)) {
          continue;
        }
        const directives = await readDirectives(include);
        if (!directives) {
          diagnostics.push({ code: "missing-include", ...context });
          continue;
        }
        active.add(include);
        await visit({ path: resources.projectPath(include), directives }, include);
        active.delete(include);
        visited.add(include);
      }
    }

    await visit(page, pageFile);
    return { taglibs: [...taglibs.values()], diagnostics, includePaths: [...includePaths].sort() };
  };
}

function isInside(root: string, absolute: string): boolean {
  const relative = path.relative(root, absolute);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
