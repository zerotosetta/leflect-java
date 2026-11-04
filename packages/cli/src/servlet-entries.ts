import fs from "fs/promises";
import path from "path";
import { parseWebXml } from "@leflect-java/parser-tld";
import type { ClassIndexEntry, MethodIndexEntry } from "@leflect-java/indexer";
import type { LeflectConfig, LeflectEntryDefinition, ServletEntryMetadata } from "@leflect-java/schema";

export async function discoverServletEntries(
  config: LeflectConfig,
  classes: readonly Pick<ClassIndexEntry, "id" | "file">[],
  methods: readonly Pick<MethodIndexEntry, "id" | "classId" | "name">[]
): Promise<{ entries: LeflectEntryDefinition[]; registrations: ServletEntryMetadata[] }> {
  const webRoot = config.jsp?.webappRoot ?? path.join(config.root, "src/main/webapp");
  const descriptor = path.join(webRoot, "WEB-INF/web.xml");
  const source = await fs.readFile(descriptor, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (source === undefined) return { entries: config.entries ?? [], registrations: [] };
  const sourcePath = path.relative(config.root, descriptor).replace(/\\/g, "/");
  const registrations = parseWebXml(source).map((mapping) => {
    const className = mapping.className ?? "";
    const own = methods.filter((method) => method.classId === className);
    const service = own.filter((method) => method.name === "service");
    const handlers = service.length ? service : own.filter((method) =>
      ["doGet", "doPost", "doPut", "doDelete", "doHead", "doOptions", "doTrace"].includes(method.name));
    return {
      ...mapping,
      className,
      sourcePath,
      handlerMethodIds: handlers.map((method) => method.id).sort(),
      diagnostic: !mapping.className ? "No servlet class declaration matches this mapping"
        : !classes.some((entry) => entry.id === className) ? "Servlet class not found in the project index"
        : handlers.length === 0 ? "No declared HTTP handler found; inherited handling is not resolved" : undefined
    };
  });
  const entries = new Map((config.entries ?? []).map((entry) => [entry.id, entry]));
  for (const registration of registrations) {
    const id = `http:${encodeURIComponent(registration.servletName)}:${encodeURIComponent(registration.urlPattern)}`;
    const target = classes.find((entry) => entry.id === registration.className);
    const duplicate = [...entries.values()].some((entry) =>
      entry.id === id || (entry.http?.servletName === registration.servletName && entry.http?.urlPattern === registration.urlPattern));
    if (duplicate) continue;
    entries.set(id, {
      id,
      type: "entry",
      label: registration.urlPattern,
      description: `${registration.servletName} → ${registration.className}`,
      tags: ["http", "discovered"],
      java: target ? [target.file] : [],
      http: registration
    });
  }
  return { entries: [...entries.values()], registrations };
}
