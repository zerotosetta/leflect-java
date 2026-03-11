import { LitElement, html, nothing } from "lit";
import { Task } from "@lit-labs/task";
import { virtualize } from "@lit-labs/virtualizer/virtualize.js";

import { fetchBootstrap, fetchFileDetail, fetchFiles, fetchGraph } from "./api";
import type {
  ProjectionBootstrap,
  ProjectionFileDetail,
  ProjectionFileEntry,
  ProjectionNodeType
} from "./types";
import "./components/dependency-graph";

class LeflectJavaProjectionApp extends LitElement {
  static properties = {
    activeTab: { state: true },
    bootstrap: { state: true },
    files: { state: true },
    selectedPath: { state: true },
    selectedGraphNodeId: { state: true },
    search: { state: true },
    classpathFilter: { state: true },
    filter: { state: true },
    depth: { state: true },
    statusMessage: { state: true }
  };

  activeTab = "dependency-tree";
  bootstrap?: ProjectionBootstrap;
  files: ProjectionFileEntry[] = [];
  selectedPath = "";
  selectedGraphNodeId = "";
  search = "";
  classpathFilter = "";
  filter: "all" | Exclude<ProjectionNodeType, "unresolved"> = "all";
  depth = 2;
  statusMessage = "analysis snapshot 대기중";

  private readonly graphTask = new Task(this, {
    task: async ([selectedPath, depth], { signal }) => {
      if (!selectedPath) {
        return undefined;
      }
      return fetchGraph(selectedPath, depth, signal);
    },
    args: () => [this.selectedPath, this.depth] as const
  });

  private readonly detailTask = new Task(this, {
    task: async ([selectedGraphNodeId], { signal }) => {
      if (!selectedGraphNodeId) {
        return undefined;
      }
      return fetchFileDetail(selectedGraphNodeId, signal);
    },
    args: () => [this.selectedGraphNodeId || this.selectedPath] as const
  });

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadInitialData();
  }

  override render() {
    const visibleFiles = this.filteredFiles;
    const selectedSummary = this.fileByPath(this.selectedGraphNodeId || this.selectedPath);

    return html`
      <div class="flex h-screen min-h-screen flex-col bg-chrome-950 text-slate-100">
        <header class="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-chrome-800 bg-chrome-900 px-2 shadow-insetline">
          <div>
            <div class="text-[10px] uppercase tracking-[0.24em] text-slate-500">leflect-java-projection</div>
            <div class="text-sm font-semibold text-slate-100">${this.bootstrap?.projectName ?? "Loading project..."}</div>
          </div>
          <nav class="flex items-center gap-1 self-stretch">
            <button class="rounded border border-chrome-700 bg-chrome-800 px-2 py-1 text-[11px] font-medium text-accent-500">
              Dependency Tree
            </button>
          </nav>
          <div class="flex items-center gap-1 text-[11px] text-slate-400">
            <span class="rounded border border-chrome-700 px-2 py-1">files ${this.bootstrap?.counts.totalFiles ?? 0}</span>
            <span class="rounded border border-chrome-700 px-2 py-1">edges ${this.bootstrap?.counts.edges ?? 0}</span>
            <span class="rounded border border-chrome-700 px-2 py-1">outbound tree</span>
          </div>
        </header>

        <main class="grid min-h-0 flex-1 grid-cols-[19rem_minmax(0,1fr)_20rem] gap-px overflow-hidden bg-chrome-800">
          <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
            <div class="border-b border-chrome-800 p-2 pb-1">
              <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500">
                <span>Index Files</span>
                <span>${visibleFiles.length}/${this.files.length}</span>
              </div>
              <input
                class="mb-1 h-8 w-full rounded border border-chrome-700 bg-chrome-950 px-2 text-[11px] outline-none placeholder:text-slate-600 focus:border-accent-500"
                placeholder="search path or package"
                .value=${this.search}
                @input=${(event: InputEvent) => {
                  this.search = (event.target as HTMLInputElement).value;
                }}
              />
              <div class="mb-1 grid grid-cols-[1fr_auto] gap-1">
                <input
                  class="h-8 min-w-0 rounded border border-chrome-700 bg-chrome-950 px-2 text-[11px] outline-none placeholder:text-slate-600 focus:border-accent-500"
                  list="classpath-options"
                  aria-label="classpath filter"
                  placeholder="classpath prefix"
                  .value=${this.classpathFilter}
                  @input=${(event: InputEvent) => {
                    this.classpathFilter = (event.target as HTMLInputElement).value;
                  }}
                />
                <button
                  class="rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-[10px] text-slate-400 hover:border-chrome-600"
                  @click=${() => {
                    this.classpathFilter = "";
                  }}
                >
                  clear
                </button>
              </div>
              <datalist id="classpath-options">
                ${this.classpathOptions.map((value) => html`<option value=${value}></option>`)}
              </datalist>
              <div class="flex items-center gap-1 text-[10px]">
                ${this.renderFilterButton("all", "ALL")}
                ${this.renderFilterButton("java", "JAVA")}
                ${this.renderFilterButton("jsp", "JSP")}
              </div>
            </div>
            <div class="min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1">
              ${visibleFiles.length > 0
                ? virtualize({
                    scroller: true,
                    items: visibleFiles,
                    renderItem: (file) => this.renderFileRow(file)
                  })
                : html`<div class="p-2 text-[11px] text-slate-500">표시할 파일이 없습니다.</div>`}
            </div>
          </aside>

          <section class="grid min-h-0 min-w-0 grid-rows-[2.5rem_minmax(0,1fr)] overflow-hidden bg-chrome-950">
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-1 border-b border-chrome-800 px-2 text-[11px]">
              <div class="min-w-0">
                <div class="truncate font-mono text-[11px] text-slate-200">${this.selectedPath || "파일을 선택하세요"}</div>
                <div class="truncate text-[10px] text-slate-500">${selectedSummary ? `${selectedSummary.nodeType.toUpperCase()} · outbound refs ${selectedSummary.referenceCount} · inbound ${selectedSummary.dependantCount}` : "graph focus 없음"}</div>
              </div>
              <label class="flex items-center gap-1 rounded border border-chrome-800 bg-chrome-900 px-2 py-1">
                <span class="text-slate-500">depth</span>
                <select class="bg-transparent outline-none" .value=${String(this.depth)} @change=${this.onDepthChange}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <button class="rounded border border-chrome-800 bg-chrome-900 px-2 py-1 text-slate-300 hover:border-accent-500" @click=${this.resetGraphSelection}>
                reset
              </button>
            </div>
            <div class="min-h-0 p-1">
              ${this.graphTask.render({
                pending: () => html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">그래프를 계산중입니다...</div>`,
                complete: (graph) => graph
                  ? html`<projection-dependency-graph
                      .graph=${graph}
                      .selectedNodeId=${this.selectedGraphNodeId || this.selectedPath}
                      @projection-node-select=${this.onGraphNodeSelect}
                    ></projection-dependency-graph>`
                  : html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">파일을 선택하세요.</div>`,
                error: (error) => html`<div class="flex h-full items-center justify-center text-[11px] text-red-300">${String(error)}</div>`
              })}
            </div>
          </section>

          <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
            <div class="border-b border-chrome-800 px-2 py-1">
              <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Detail</div>
              <div class="truncate font-mono text-[11px] text-slate-200">${this.selectedGraphNodeId || this.selectedPath || "-"}</div>
            </div>
            <div class="min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 text-[11px]">
              ${this.detailTask.render({
                pending: () => html`<div class="py-2 text-slate-500">detail loading...</div>`,
                complete: (detail) => detail ? this.renderDetail(detail) : html`<div class="py-2 text-slate-500">detail 없음</div>`,
                error: (error) => html`<div class="py-2 text-red-300">${String(error)}</div>`
              })}
            </div>
          </aside>
        </main>

        <footer class="grid h-7 grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-chrome-800 bg-chrome-900 px-2 text-[10px] text-slate-400">
          <div class="truncate">${this.statusMessage}</div>
          <div>${this.bootstrap ? `java ${this.bootstrap.counts.javaFiles} · jsp ${this.bootstrap.counts.jspFiles}` : "snapshot idle"}</div>
          <div>${this.selectedPath ? `focus ${this.selectedPath}` : "no focus"}</div>
        </footer>
      </div>
    `;
  }

  private async loadInitialData(): Promise<void> {
    this.statusMessage = "analysis snapshot 로딩중";
    const [bootstrap, filesPayload] = await Promise.all([fetchBootstrap(), fetchFiles()]);
    this.bootstrap = bootstrap;
    this.files = filesPayload.files;
    const defaultFile = bootstrap.defaultFile ?? filesPayload.files[0]?.path ?? "";
    this.selectedPath = defaultFile;
    this.selectedGraphNodeId = defaultFile;
    this.statusMessage = `${filesPayload.files.length} files loaded`;
  }

  private get filteredFiles(): ProjectionFileEntry[] {
    const query = this.search.trim().toLowerCase();
    const classpathQuery = this.classpathFilter.trim().toLowerCase();
    return this.files.filter((file) => {
      if (this.filter !== "all" && file.nodeType !== this.filter) {
        return false;
      }
      const classpath = this.classpathForFile(file).toLowerCase();
      if (classpathQuery && !classpath.startsWith(classpathQuery)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${file.path} ${file.packageName ?? ""} ${classpath}`.toLowerCase().includes(query);
    });
  }

  private get classpathOptions(): string[] {
    return [...new Set(this.files.map((file) => this.classpathForFile(file)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }

  private fileByPath(path: string): ProjectionFileEntry | undefined {
    return this.files.find((file) => file.path === path);
  }

  private renderFilterButton(filter: "all" | "java" | "jsp", label: string) {
    const active = this.filter === filter;
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
        @click=${() => {
          this.filter = filter;
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderFileRow(file: ProjectionFileEntry) {
    const active = file.path === this.selectedPath;
    return html`
      <button
        class=${active
          ? "mb-1 grid w-full gap-0.5 rounded border border-accent-500 bg-chrome-800 px-2 py-1 text-left shadow-insetline"
          : "mb-1 grid w-full gap-0.5 rounded border border-transparent bg-transparent px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900"}
        @click=${() => {
          this.selectedPath = file.path;
          this.selectedGraphNodeId = file.path;
          this.statusMessage = `${file.path} selected`;
        }}
      >
        <div class="flex items-center gap-1">
          <span class=${file.nodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[10px] text-accent-500" : "rounded bg-emerald-950 px-1 py-0.5 text-[10px] text-accent-400"}>${file.nodeType}</span>
          <span class="truncate font-mono text-[11px] text-slate-100">${file.path.split("/").at(-1)}</span>
        </div>
        <div class="truncate text-[10px] text-slate-400">${this.classpathForFile(file)}</div>
        <div class="truncate font-mono text-[10px] text-slate-500">${file.path}</div>
        <div class="flex items-center gap-2 text-[10px] text-slate-400">
          <span>out ${file.referenceCount}</span>
          <span>in ${file.dependantCount}</span>
          ${file.classCount !== undefined ? html`<span>methods ${file.methodCount ?? 0}</span>` : html`<span>tags ${file.tagCount ?? 0}</span>`}
        </div>
      </button>
    `;
  }

  private renderDetail(detail: ProjectionFileDetail) {
    const file = detail.file;
    const metadata = detail.metadata ?? {};
    const metadataSections = file.nodeType === "java"
      ? [
          this.renderListSection("Imports", toStringList(metadata, "importEntries", "import"), 8),
          this.renderListSection("Classes", toStringList(metadata, "classes", "id"), 6),
          this.renderListSection("Methods", toStringList(metadata, "methods", "id"), 10),
          this.renderListSection("Calls", toStringList(metadata, "calls", "to"), 10)
        ]
      : [
          this.renderListSection("Taglibs", toStringList(metadata, "taglibs", "uri"), 8),
          this.renderListSection("Tags", toStringList(metadata, "tags", "name"), 10),
          this.renderListSection("Scriptlets", toStringList(metadata, "scriptlets", "code"), 6),
          this.renderListSection("Method Calls", toStringList(metadata, "methodCalls", "methodName"), 10)
        ];

    return html`
      <div class="grid gap-2">
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Summary</span>
            <span class=${file.nodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[10px] text-accent-500" : file.nodeType === "java" ? "rounded bg-emerald-950 px-1 py-0.5 text-[10px] text-accent-400" : "rounded bg-rose-950 px-1 py-0.5 text-[10px] text-accent-200"}>${file.nodeType}</span>
          </div>
          <div class="truncate font-mono text-[11px] text-slate-100">${file.path}</div>
          <div class="mt-1 grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            <div class="rounded border border-chrome-800 px-2 py-1">out ${file.referenceCount}</div>
            <div class="rounded border border-chrome-800 px-2 py-1">in ${file.dependantCount}</div>
            ${file.classCount !== undefined ? html`<div class="rounded border border-chrome-800 px-2 py-1">classes ${file.classCount ?? 0}</div>` : nothing}
            ${file.methodCount !== undefined ? html`<div class="rounded border border-chrome-800 px-2 py-1">methods ${file.methodCount ?? 0}</div>` : nothing}
            ${file.tagCount !== undefined ? html`<div class="rounded border border-chrome-800 px-2 py-1">tags ${file.tagCount ?? 0}</div>` : nothing}
            ${file.methodCallCount !== undefined ? html`<div class="rounded border border-chrome-800 px-2 py-1">method calls ${file.methodCallCount ?? 0}</div>` : nothing}
          </div>
          ${this.renderFocusButton(file)}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">References</div>
          ${this.renderReferenceTable(detail.references)}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Referenced By</div>
          ${this.renderReferenceTable(detail.referencedBy)}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Shard Metadata</div>
          <div class="grid gap-2">${metadataSections}</div>
        </section>
      </div>
    `;
  }

  private renderFocusButton(file: ProjectionFileEntry) {
    if (file.nodeType === "unresolved" || file.path === this.selectedPath) {
      return nothing;
    }
    return html`
      <button
        class="mt-2 rounded border border-accent-500 px-2 py-1 text-[10px] font-semibold text-accent-500 hover:bg-chrome-900"
        @click=${() => {
          this.selectedPath = file.path;
          this.selectedGraphNodeId = file.path;
          this.statusMessage = `${file.path} focus moved`;
        }}
      >
        focus in graph
      </button>
    `;
  }

  private renderReferenceTable(items: ProjectionFileDetail["references"]) {
    if (items.length === 0) {
      return html`<div class="text-[10px] text-slate-500">없음</div>`;
    }

    return html`
      <div class="grid gap-1">
        ${items.slice(0, 20).map((item) => html`
          <button
            class="rounded border border-chrome-800 px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900"
            @click=${() => {
              this.selectedGraphNodeId = item.path;
              this.statusMessage = `${item.path} detail selected`;
            }}
          >
            <div class="truncate font-mono text-[10px] text-slate-100">${item.path}</div>
            <div class="truncate text-[10px] text-slate-500">${item.edgeTypes.join(", ")} · ${item.symbols.slice(0, 2).join(", ")}</div>
          </button>
        `)}
      </div>
    `;
  }

  private renderListSection(title: string, items: string[], limit: number) {
    return html`
      <div>
        <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <span>${title}</span>
          <span>${items.length}</span>
        </div>
        ${items.length > 0
          ? html`<div class="grid gap-1">${items.slice(0, limit).map((item) => html`<div class="truncate rounded border border-chrome-800 px-2 py-1 font-mono text-[10px] text-slate-300">${item}</div>`)}</div>`
          : html`<div class="text-[10px] text-slate-500">없음</div>`}
      </div>
    `;
  }

  private onDepthChange = (event: Event) => {
    this.depth = Number((event.target as HTMLSelectElement).value);
    this.statusMessage = `depth ${this.depth}`;
  };

  private onGraphNodeSelect = (event: CustomEvent<{ nodeId: string }>) => {
    this.selectedGraphNodeId = event.detail.nodeId;
    this.statusMessage = `${event.detail.nodeId} detail selected`;
  };

  private resetGraphSelection = () => {
    this.selectedGraphNodeId = this.selectedPath;
    this.statusMessage = "detail selection reset";
  };

  private classpathForFile(file: ProjectionFileEntry): string {
    if (file.packageName) {
      return file.packageName;
    }
    const parts = file.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : file.path;
  }
}

function toStringList(metadata: Record<string, unknown>, key: string, field: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && field in item) {
        const fieldValue = (item as Record<string, unknown>)[field];
        if (typeof fieldValue === "string") {
          return fieldValue;
        }
      }
      return JSON.stringify(item);
    })
    .filter((item): item is string => Boolean(item));
}

customElements.define("leflect-java-projection-app", LeflectJavaProjectionApp);
