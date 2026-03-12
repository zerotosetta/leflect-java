import type {
  ProjectionBootstrap,
  ProjectionEntry,
  ProjectionFileDetail,
  ProjectionFileEntry,
  ProjectionGraphResponse
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

export function fetchFiles(signal?: AbortSignal): Promise<{ files: ProjectionFileEntry[] }> {
  return getJson<{ files: ProjectionFileEntry[] }>("/api/files", signal);
}

export function fetchEntries(signal?: AbortSignal): Promise<{ entries: ProjectionEntry[] }> {
  return getJson<{ entries: ProjectionEntry[] }>("/api/entries", signal);
}

export function fetchGraph(
  options: {
    path?: string;
    depth: number;
    entryId?: string;
  },
  signal?: AbortSignal
): Promise<ProjectionGraphResponse> {
  const params = new URLSearchParams({ depth: String(options.depth) });
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
