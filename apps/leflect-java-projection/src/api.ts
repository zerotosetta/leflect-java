import type {
  ProjectionAstGraphResponse,
  ProjectionBootstrap,
  ProjectionDependencyEdgeKind,
  ProjectionEntriesPageResponse,
  ProjectionEntry,
  ProjectionFileDetail,
  ProjectionFileEntry,
  ProjectionFilesPageResponse,
  ProjectionGraphResponse,
  ProjectionTreeAncestorsResponse,
  ProjectionTreeMode,
  ProjectionTreeResponse
} from "./types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function fetchBootstrap(signal?: AbortSignal): Promise<ProjectionBootstrap> {
  return getJson<ProjectionBootstrap>("/api/bootstrap", signal);
}

export function fetchFilesPage(
  options: {
    offset?: number;
    limit?: number;
    nodeType?: "all" | "java" | "jsp";
    search?: string;
    classpathPrefix?: string;
  },
  signal?: AbortSignal
): Promise<ProjectionFilesPageResponse> {
  const params = new URLSearchParams();
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.nodeType && options.nodeType !== "all") {
    params.set("nodeType", options.nodeType);
  }
  if (options.search) {
    params.set("search", options.search);
  }
  if (options.classpathPrefix) {
    params.set("classpathPrefix", options.classpathPrefix);
  }
  return getJson<ProjectionFilesPageResponse>(`/api/files?${params.toString()}`, signal);
}

export function fetchEntriesPage(
  options: {
    offset?: number;
    limit?: number;
    search?: string;
  },
  signal?: AbortSignal
): Promise<ProjectionEntriesPageResponse> {
  const params = new URLSearchParams();
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.search) {
    params.set("search", options.search);
  }
  return getJson<ProjectionEntriesPageResponse>(`/api/entries?${params.toString()}`, signal);
}

export function fetchEntryDetail(
  options: {
    id?: string;
    focusPath?: string;
  },
  signal?: AbortSignal
): Promise<{ entry: ProjectionEntry }> {
  const params = new URLSearchParams();
  if (options.id) {
    params.set("id", options.id);
  }
  if (options.focusPath) {
    params.set("focusPath", options.focusPath);
  }
  return getJson<{ entry: ProjectionEntry }>(`/api/entry-detail?${params.toString()}`, signal);
}

export function fetchGraph(
  options: {
    path?: string;
    depth?: number;
    maxNodes?: number;
    entryId?: string;
    edgeKinds?: ProjectionDependencyEdgeKind[];
  },
  signal?: AbortSignal
): Promise<ProjectionGraphResponse> {
  const params = new URLSearchParams();
  if (options.depth !== undefined) {
    params.set("depth", String(options.depth));
  }
  if (options.maxNodes !== undefined) {
    params.set("maxNodes", String(options.maxNodes));
  }
  if (options.edgeKinds && options.edgeKinds.length > 0) {
    params.set("edgeKinds", options.edgeKinds.join(","));
  }
  if (options.path) {
    params.set("path", options.path);
  }
  if (options.entryId) {
    params.set("entryId", options.entryId);
  }
  return getJson<ProjectionGraphResponse>(`/api/dependency-graph?${params.toString()}`, signal);
}

export function fetchFileDetail(path: string, signal?: AbortSignal): Promise<ProjectionFileDetail> {
  const params = new URLSearchParams({ path });
  return getJson<ProjectionFileDetail>(`/api/file-detail?${params.toString()}`, signal);
}

export function fetchAstGraph(
  options: {
    path: string;
    includeExternal?: boolean;
  },
  signal?: AbortSignal
): Promise<ProjectionAstGraphResponse> {
  const params = new URLSearchParams({ path: options.path });
  if (options.includeExternal) {
    params.set("includeExternal", "true");
  }
  return getJson<ProjectionAstGraphResponse>(`/api/ast-graph?${params.toString()}`, signal);
}

export function fetchTreeNodes(
  options: {
    mode: ProjectionTreeMode;
    parentId?: string;
    nodeType?: "all" | "java" | "jsp";
    search?: string;
  },
  signal?: AbortSignal
): Promise<ProjectionTreeResponse> {
  const params = new URLSearchParams({ mode: options.mode });
  if (options.parentId) {
    params.set("parentId", options.parentId);
  }
  if (options.nodeType && options.nodeType !== "all") {
    params.set("nodeType", options.nodeType);
  }
  if (options.search) {
    params.set("search", options.search);
  }
  return getJson<ProjectionTreeResponse>(`/api/tree?${params.toString()}`, signal);
}

export function fetchTreeAncestors(
  path: string,
  mode: ProjectionTreeMode,
  signal?: AbortSignal
): Promise<ProjectionTreeAncestorsResponse> {
  const params = new URLSearchParams({ path, mode });
  return getJson<ProjectionTreeAncestorsResponse>(`/api/tree-ancestors?${params.toString()}`, signal);
}
