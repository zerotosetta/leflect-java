import { LitElement, html, nothing, type TemplateResult } from "lit";
import { Task } from "@lit-labs/task";
import { virtualize } from "@lit-labs/virtualizer/virtualize.js";

import {
  fetchAstGraph,
  fetchBootstrap,
  fetchEntriesPage,
  fetchEntryDetail,
  fetchFileDetail,
  fetchFilesPage,
  fetchGraph,
  fetchTreeAncestors,
  fetchTreeNodes
} from "./api";
import type {
  ProjectionAstLayout,
  ProjectionDependencyEdgeKind,
  ProjectionGraphMode,
  ProjectionSourceHighlight,
  ProjectionBootstrap,
  ProjectionEntry,
  ProjectionFileDetail,
  ProjectionFileEntry,
  ProjectionNodeType,
  ProjectionTheme,
  ProjectionTreeMode,
  ProjectionTreeNode
} from "./types";
import "./components/ast-graph";
import "./components/dependency-graph";
import "./components/source-viewer";

type SidebarEdge = "left" | "right";

type SidebarResizeSession = {
  side: SidebarEdge;
  startX: number;
  startLeftWidth: number;
  startRightWidth: number;
};

const ROOT_TREE_PARENT = "__root__";
const ENTRY_PAGE_SIZE = 100;
const ENTRY_SCROLL_THRESHOLD = 320;
const FILE_PAGE_SIZE = 200;
const FILE_SCROLL_THRESHOLD = 320;
const MIN_GRAPH_MAX_NODES = 20;
const DEFAULT_GRAPH_MAX_NODES = 240;
const GRAPH_EDGE_KIND_OPTIONS: Array<{ id: ProjectionDependencyEdgeKind; label: string }> = [
  { id: "call", label: "CALL" },
  { id: "import", label: "IMPORT" },
  { id: "type", label: "TYPE" },
  { id: "tag", label: "TAG" }
];
const THEME_STORAGE_KEY = "leflect-java-projection.theme";
const THEME_OPTIONS: Array<{ id: ProjectionTheme; label: string }> = [
  { id: "dark", label: "DARK" },
  { id: "light", label: "LIGHT" },
  { id: "sky", label: "SKY" }
];

class LeflectJavaProjectionApp extends LitElement {
  static properties = {
    activeTab: { state: true },
    bootstrap: { state: true },
    entries: { state: true },
    entriesLoading: { state: true },
    entriesTotal: { state: true },
    entriesHasMore: { state: true },
    files: { state: true },
    filesTotal: { state: true },
    filesHasMore: { state: true },
    filesLoading: { state: true },
    treeNodesByParent: { state: true },
    treeLoadedParentIds: { state: true },
    treeLoadingParentIds: { state: true },
    treeTotalFiles: { state: true },
    treeRootLoading: { state: true },
    selectedEntryId: { state: true },
    selectedPath: { state: true },
    selectedGraphNodeId: { state: true },
    search: { state: true },
    classpathFilter: { state: true },
    filter: { state: true },
    graphMaxNodes: { state: true },
    graphEdgeKinds: { state: true },
    graphMode: { state: true },
    astLayout: { state: true },
    includeExternalAst: { state: true },
    treeMode: { state: true },
    expandedTreeKeys: { state: true },
    leftSidebarWidth: { state: true },
    rightSidebarWidth: { state: true },
    resizingSidebar: { state: true },
    statusMessage: { state: true },
    theme: { state: true },
    selectedAstNodeId: { state: true },
    sourceHighlight: { state: true }
  };

  activeTab = "dependency-tree";
  bootstrap?: ProjectionBootstrap;
  entries: ProjectionEntry[] = [];
  entriesLoading = false;
  entriesTotal = 0;
  entriesHasMore = false;
  files: ProjectionFileEntry[] = [];
  filesTotal = 0;
  filesHasMore = false;
  filesLoading = false;
  treeNodesByParent: Record<string, ProjectionTreeNode[]> = {};
  treeLoadedParentIds: string[] = [];
  treeLoadingParentIds: string[] = [];
  treeTotalFiles = 0;
  treeRootLoading = false;
  selectedEntryId = "";
  selectedPath = "";
  selectedGraphNodeId = "";
  search = "";
  classpathFilter = "";
  filter: "all" | Exclude<ProjectionNodeType, "unresolved"> = "all";
  graphMaxNodes = DEFAULT_GRAPH_MAX_NODES;
  graphEdgeKinds: ProjectionDependencyEdgeKind[] = GRAPH_EDGE_KIND_OPTIONS.map((option) => option.id);
  graphMode: ProjectionGraphMode = "dependency";
  astLayout: ProjectionAstLayout = "force";
  includeExternalAst = false;
  treeMode: ProjectionTreeMode = "classpath";
  expandedTreeKeys: string[] = [];
  leftSidebarWidth = 304;
  rightSidebarWidth = 320;
  resizingSidebar: SidebarEdge | "" = "";
  statusMessage = "Waiting for analysis snapshot";
  theme: ProjectionTheme = "dark";
  selectedAstNodeId = "";
  sourceHighlight?: ProjectionSourceHighlight;

  private readonly resizeHandleWidth = 6;
  private readonly minCenterWidth = 320;
  private readonly minSidebarWidth = 180;
  private resizeSession?: SidebarResizeSession;
  private entriesReady = false;
  private entriesQueryVersion = 0;
  private filesQueryVersion = 0;
  private treeQueryVersion = 0;
  private readonly entryCacheById = new Map<string, ProjectionEntry>();
  private readonly fileCacheByPath = new Map<string, ProjectionFileEntry>();

  private readonly graphTask = new Task(this, {
    task: async ([selectedPath, activeTab, selectedEntryId, filter, graphMaxNodes, graphEdgeKinds], { signal }) => {
      if (activeTab === "entries" || filter === "entry") {
        await this.ensureEntryListReady(signal);
        if (selectedEntryId) {
          await this.ensureEntryLoaded({ id: selectedEntryId }, signal);
        }
      }

      const selectedEntry = selectedEntryId ? this.entryCacheById.get(selectedEntryId) : undefined;
      const entryId = activeTab === "entries" || filter === "entry" ? selectedEntryId || undefined : undefined;
      const path = activeTab === "entries" || filter === "entry"
        ? selectedEntry?.focusPath
        : selectedPath || undefined;
      if (!path && !entryId) {
        return undefined;
      }

      return fetchGraph({ path, entryId, maxNodes: graphMaxNodes, edgeKinds: graphEdgeKinds.split(",").filter(Boolean) as ProjectionDependencyEdgeKind[] }, signal);
    },
    args: () => [
      this.selectedPath,
      this.activeTab,
      this.selectedEntryId,
      this.filter,
      this.graphMaxNodes,
      this.graphEdgeKinds.join(",")
    ] as const
  });

  private readonly astGraphTask = new Task(this, {
    task: async ([selectedPath, activeTab, selectedEntryId, filter, includeExternalAst], { signal }) => {
      if (activeTab === "entries" || filter === "entry") {
        await this.ensureEntryListReady(signal);
        if (selectedEntryId) {
          await this.ensureEntryLoaded({ id: selectedEntryId }, signal);
        }
      }

      const selectedEntry = selectedEntryId ? this.entryCacheById.get(selectedEntryId) : undefined;
      const focusPath = activeTab === "entries" || filter === "entry"
        ? selectedEntry?.focusPath
        : selectedPath || undefined;
      if (!focusPath) {
        return undefined;
      }
      return fetchAstGraph({ path: focusPath, includeExternal: includeExternalAst }, signal);
    },
    args: () => [this.selectedPath, this.activeTab, this.selectedEntryId, this.filter, this.includeExternalAst] as const
  });

  private readonly detailTask = new Task(this, {
    task: async ([selectedGraphNodeId], { signal }) => {
      if (!selectedGraphNodeId || selectedGraphNodeId.startsWith("entry:")) {
        return undefined;
      }

      const detail = await fetchFileDetail(selectedGraphNodeId, signal);
      this.cacheFiles([detail.file]);
      return detail;
    },
    args: () => [this.selectedGraphNodeId || this.selectedPath] as const
  });

  override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.theme = this.readStoredTheme();
    this.applyTheme();
    window.addEventListener("resize", this.onViewportResize);
    void this.loadInitialData();
  }

  override firstUpdated(): void {
    this.syncSidebarWidths();
  }

  override disconnectedCallback(): void {
    this.stopSidebarResize();
    window.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  override render() {
    const selectedSummary = this.fileByPath(this.selectedGraphNodeId || this.selectedPath);
    const selectedEntry = this.selectedEntry;
    const tabs = uniqueTabs([
      ...(this.bootstrap?.tabs ?? [
        { id: "dependency-tree", label: "Dependency Tree" },
        { id: "tree-view", label: "Tree View" },
        { id: "entries", label: "Entries" }
      ]),
      { id: "tree-view", label: "Tree View" }
    ]).filter((tab) => tab.id !== "entries");
    const modeBadge = this.activeTab === "tree-view"
      ? `${this.treeMode} tree`
      : this.activeTab === "entries"
        ? "entry browser"
        : "outbound tree";

    return html`
      <div class="projection-theme-shell flex h-screen min-h-screen flex-col bg-chrome-950 text-slate-100">
        <header class="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-chrome-800 bg-chrome-900 px-2 shadow-insetline">
          <div>
            <div class="text-[10px] uppercase tracking-[0.24em] text-slate-500">leflect-java-projection</div>
            <div class="text-sm font-semibold text-slate-100">${this.bootstrap?.projectName ?? "Loading project..."}</div>
          </div>
          <nav class="flex items-center gap-1 self-stretch">
            ${tabs.map((tab) => this.renderTabButton(tab.id, tab.label))}
          </nav>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1 rounded border border-chrome-700 bg-chrome-950 px-1 py-1">
              <span class="px-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Theme</span>
              ${THEME_OPTIONS.map((option) => this.renderThemeButton(option.id, option.label))}
            </div>
            <div class="flex items-center gap-1 text-[11px] text-slate-400">
              <span class="rounded border border-chrome-700 px-2 py-1">entries ${this.bootstrap?.counts.entries ?? 0}</span>
              <span class="rounded border border-chrome-700 px-2 py-1">files ${this.bootstrap?.counts.totalFiles ?? 0}</span>
              <span class="rounded border border-chrome-700 px-2 py-1">edges ${this.bootstrap?.counts.edges ?? 0}</span>
              <span class="rounded border border-chrome-700 px-2 py-1">${modeBadge}</span>
            </div>
          </div>
        </header>

        <main
          data-main-layout
          class=${this.resizingSidebar
            ? "grid min-h-0 flex-1 overflow-hidden bg-chrome-800 select-none"
            : "grid min-h-0 flex-1 overflow-hidden bg-chrome-800"}
          style=${this.layoutStyle}
        >
          ${this.activeTab === "tree-view"
            ? this.renderTreeViewLayout(selectedSummary, selectedEntry)
            : this.activeTab === "entries"
              ? this.renderEntriesLayout(selectedEntry)
              : this.renderDependencyTreeLayout(this.files, selectedSummary, selectedEntry)}
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
    this.statusMessage = "Loading analysis snapshot";
    const bootstrap = await fetchBootstrap();
    this.bootstrap = bootstrap;
    this.entriesTotal = bootstrap.counts.entries;
    this.filesTotal = bootstrap.counts.totalFiles;
    this.selectedEntryId = bootstrap.defaultEntryId ?? "";
    this.selectedPath = bootstrap.defaultFile ?? "";
    this.selectedGraphNodeId = bootstrap.defaultFile ?? "";
    this.statusMessage = "Analysis snapshot loaded";
    await this.refreshActiveData();
  }

  private readStoredTheme(): ProjectionTheme {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.some((option) => option.id === storedTheme)
      ? (storedTheme as ProjectionTheme)
      : "dark";
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, this.theme);
  }

  private setTheme(theme: ProjectionTheme): void {
    if (this.theme === theme) {
      return;
    }
    this.theme = theme;
    this.applyTheme();
  }

  private get classpathOptions(): string[] {
    return [...new Set(this.files.map((file) => this.classpathForFile(file)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }

  private get selectedEntry(): ProjectionEntry | undefined {
    return this.entryCacheById.get(this.selectedEntryId);
  }

  private get isEntryFilter(): boolean {
    return this.filter === "entry";
  }

  private get treeNodeTypeFilter(): "all" | "java" | "jsp" {
    return this.filter === "java" || this.filter === "jsp" ? this.filter : "all";
  }

  private get layoutStyle(): string {
    return `grid-template-columns: ${this.leftSidebarWidth}px ${this.resizeHandleWidth}px minmax(0, 1fr) ${this.resizeHandleWidth}px ${this.rightSidebarWidth}px;`;
  }

  private get layoutElement(): HTMLElement | null {
    return this.querySelector<HTMLElement>("[data-main-layout]");
  }

  private get rootTreeNodes(): ProjectionTreeNode[] {
    return this.treeNodesByParent[ROOT_TREE_PARENT] ?? [];
  }

  private fileByPath(path: string): ProjectionFileEntry | undefined {
    return this.fileCacheByPath.get(path);
  }

  private renderTabButton(tabId: string, label: string) {
    const active = this.activeTab === tabId;
    return html`
      <button
        class=${active
          ? "rounded border border-chrome-700 bg-chrome-800 px-2 py-1 text-[11px] font-medium text-accent-500"
          : "rounded border border-chrome-800 bg-chrome-950 px-2 py-1 text-[11px] text-slate-400 hover:border-chrome-700 hover:text-slate-200"}
        @click=${() => {
          void this.onTabSelected(tabId, label);
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderThemeButton(theme: ProjectionTheme, label: string) {
    const active = this.theme === theme;
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 text-[10px] font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-[10px] text-slate-400 hover:border-chrome-600 hover:text-slate-200"}
        @click=${() => {
          this.setTheme(theme);
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderDependencyTreeLayout(
    visibleFiles: ProjectionFileEntry[],
    selectedSummary: ProjectionFileEntry | undefined,
    selectedEntry: ProjectionEntry | undefined
  ) {
    const detailLabel = this.isEntryFilter
      ? selectedEntry?.label ?? "-"
      : this.selectedGraphNodeId || this.selectedPath || "-";

    return html`
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        ${this.renderFileSidebar(visibleFiles)}
      </aside>
      ${this.renderResizeHandle("left")}
      ${this.renderGraphWorkspace({
        title: this.isEntryFilter
          ? selectedEntry?.label ?? "Select an entry"
          : this.selectedPath || "Select a file",
        subtitle: this.isEntryFilter
          ? selectedEntry
            ? `${selectedEntry.entryType ?? selectedEntry.source} · focus ${selectedEntry.focusPath ?? "unmatched"} · reach ${selectedEntry.reachableCount} · edges ${selectedEntry.edgeCount}`
            : "Select an entry to inspect its focus graph."
          : selectedEntry
            ? `entry ${selectedEntry.label} · ${selectedSummary ? `${selectedSummary.nodeType.toUpperCase()} · outbound refs ${selectedSummary.referenceCount} · inbound ${selectedSummary.dependantCount}` : "No graph focus selected"}`
            : selectedSummary
              ? `${selectedSummary.nodeType.toUpperCase()} · outbound refs ${selectedSummary.referenceCount} · inbound ${selectedSummary.dependantCount}`
              : "No graph focus selected",
        emptyMessage: this.isEntryFilter
          ? "Select an entry to inspect its graph."
          : "Select a file to inspect its outbound dependency tree."
      })}
      ${this.renderResizeHandle("right")}
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        <div class="border-b border-chrome-800 px-2 py-1">
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">${this.isEntryFilter ? "Entry" : "Detail"}</div>
          <div class="break-all font-mono text-[11px] text-slate-200">${detailLabel}</div>
        </div>
        <div class="min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 text-[11px]">
          ${this.isEntryFilter
            ? selectedEntry
              ? this.renderEntryDetail(selectedEntry)
              : this.entriesLoading
                ? html`<div class="py-2 text-slate-500">entry loading...</div>`
                : html`<div class="py-2 text-slate-500">No entry selected.</div>`
            : this.detailTask.render({
                pending: () => html`<div class="py-2 text-slate-500">detail loading...</div>`,
                complete: (detail) => detail ? this.renderDetail(detail) : html`<div class="py-2 text-slate-500">No detail available.</div>`,
                error: (error) => html`<div class="py-2 text-red-300">${String(error)}</div>`
              })}
        </div>
      </aside>
    `;
  }

  private renderTreeViewLayout(
    selectedSummary: ProjectionFileEntry | undefined,
    selectedEntry: ProjectionEntry | undefined
  ) {
    const detailLabel = this.selectedGraphNodeId || this.selectedPath || "-";
    const modeLabel = this.treeMode === "classpath" ? "Classpath" : "Directory";
    const subtitle = selectedSummary
      ? `${modeLabel} tree · ${selectedSummary.nodeType.toUpperCase()} · outbound refs ${selectedSummary.referenceCount} · inbound ${selectedSummary.dependantCount}`
      : selectedEntry
        ? `${modeLabel} tree · entry ${selectedEntry.label}`
        : `Select a file from the ${modeLabel.toLowerCase()} tree.`;

    return html`
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        ${this.renderTreeSidebar()}
      </aside>
      ${this.renderResizeHandle("left")}
      ${this.renderGraphWorkspace({
        title: this.selectedPath || `Select a file in ${modeLabel} tree`,
        subtitle,
        emptyMessage: `Select a file from the ${modeLabel.toLowerCase()} tree to inspect its outbound dependency tree.`
      })}
      ${this.renderResizeHandle("right")}
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        <div class="border-b border-chrome-800 px-2 py-1">
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Detail</div>
          <div class="break-all font-mono text-[11px] text-slate-200">${detailLabel}</div>
        </div>
        <div class="min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 text-[11px]">
          ${this.detailTask.render({
            pending: () => html`<div class="py-2 text-slate-500">detail loading...</div>`,
            complete: (detail) => detail ? this.renderDetail(detail) : html`<div class="py-2 text-slate-500">No detail available.</div>`,
            error: (error) => html`<div class="py-2 text-red-300">${String(error)}</div>`
          })}
        </div>
      </aside>
    `;
  }

  private renderEntriesLayout(selectedEntry: ProjectionEntry | undefined) {
    return html`
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        ${this.renderEntriesSidebar({
          title: "Entries",
          countLabel: `${this.entries.length}/${this.entriesTotal || this.bootstrap?.counts.entries || 0}`,
          showFilterButtons: false
        })}
      </aside>
      ${this.renderResizeHandle("left")}
      ${this.renderGraphWorkspace({
        title: selectedEntry?.label ?? "Select an entry",
        subtitle: selectedEntry
          ? `${selectedEntry.entryType ?? selectedEntry.source} · focus ${selectedEntry.focusPath ?? "unmatched"} · reach ${selectedEntry.reachableCount} · edges ${selectedEntry.edgeCount}`
          : "Select an entry to inspect its focus graph.",
        emptyMessage: "Select an entry to inspect its graph."
      })}
      ${this.renderResizeHandle("right")}
      <aside class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-chrome-900">
        <div class="border-b border-chrome-800 px-2 py-1">
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Entry</div>
          <div class="break-words text-[11px] text-slate-200">${selectedEntry?.label ?? "-"}</div>
        </div>
        <div class="min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 text-[11px]">
          ${selectedEntry
            ? this.renderEntryDetail(selectedEntry)
            : this.entriesLoading
              ? html`<div class="py-2 text-slate-500">entry loading...</div>`
              : html`<div class="py-2 text-slate-500">No entry selected.</div>`}
        </div>
      </aside>
    `;
  }

  private renderTreeSidebar() {
    return html`
      <div class="border-b border-chrome-800 p-2 pb-1">
        <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500">
          <span>Tree View</span>
          <span>${this.treeTotalFiles}/${this.bootstrap?.counts.totalFiles ?? 0}</span>
        </div>
        <div class="mb-1 flex items-center gap-1 text-[10px]">
          ${this.renderTreeModeButton("classpath", "CLASSPATH")}
          ${this.renderTreeModeButton("directory", "DIRECTORY")}
        </div>
        <div class="mb-1 flex items-center gap-1 text-[10px]">
          ${this.renderFilterButton("all", "ALL")}
          ${this.renderFilterButton("java", "JAVA")}
          ${this.renderFilterButton("jsp", "JSP")}
        </div>
        <input
          class="mb-1 h-8 w-full rounded border border-chrome-700 bg-chrome-950 px-2 text-[11px] outline-none placeholder:text-slate-600 focus:border-accent-500"
          placeholder=${this.treeMode === "classpath" ? "filter classpath or file" : "filter directory or file"}
          .value=${this.search}
          @input=${(event: InputEvent) => {
            this.search = (event.target as HTMLInputElement).value;
            void this.refreshTreeRoot();
          }}
        />
        <div class="text-[10px] text-slate-500">
          ${this.treeMode === "classpath"
            ? "Tree nodes fetch children lazily from the server as you expand packages."
            : "Tree nodes fetch children lazily from the server as you expand directories."}
        </div>
      </div>
      <div class="min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1">
        ${this.treeRootLoading && this.rootTreeNodes.length === 0
          ? html`<div class="p-2 text-[11px] text-slate-500">tree loading...</div>`
          : this.rootTreeNodes.length > 0
            ? html`<div class="grid gap-0.5">${this.rootTreeNodes.map((node) => this.renderTreeNode(node, 0))}</div>`
            : html`<div class="p-2 text-[11px] text-slate-500">No files match the current tree filters.</div>`}
      </div>
    `;
  }

  private renderFileSidebar(visibleFiles: ProjectionFileEntry[]) {
    if (this.isEntryFilter) {
      return this.renderEntriesSidebar({
        title: "Entries",
        countLabel: `${this.entries.length}/${this.entriesTotal || this.bootstrap?.counts.entries || 0}`,
        showFilterButtons: true
      });
    }

    const totalCount = this.filesTotal;
    return html`
      <div class="border-b border-chrome-800 p-2 pb-1">
        <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500">
          <span>Index Files</span>
          <span>${visibleFiles.length}/${totalCount}</span>
        </div>
        <div class="mb-1 flex items-center gap-1 text-[10px]">
          ${this.renderFilterButton("all", "ALL")}
          ${this.renderFilterButton("java", "JAVA")}
          ${this.renderFilterButton("jsp", "JSP")}
          ${this.renderFilterButton("entry", "ENTRIES")}
        </div>
        <input
          class="mb-1 h-8 w-full rounded border border-chrome-700 bg-chrome-950 px-2 text-[11px] outline-none placeholder:text-slate-600 focus:border-accent-500"
          placeholder="search path or package"
          .value=${this.search}
          @input=${(event: InputEvent) => {
            this.search = (event.target as HTMLInputElement).value;
            void this.refreshDependencyFiles();
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
              void this.refreshDependencyFiles();
            }}
          />
          <button
            class="rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-[10px] text-slate-400 hover:border-chrome-600"
            @click=${() => {
              this.classpathFilter = "";
              void this.refreshDependencyFiles();
            }}
          >
            clear
          </button>
        </div>
        <datalist id="classpath-options">
          ${this.classpathOptions.map((value) => html`<option value=${value}></option>`)}
        </datalist>
      </div>
      <div
        class="min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1"
        @scroll=${this.onFileSidebarScroll}
      >
        ${visibleFiles.length > 0
          ? html`
              ${virtualize({
                items: visibleFiles,
                scroller: true,
                renderItem: (file) => this.renderFileRow(file)
              })}
              ${this.filesLoading ? html`<div class="px-2 py-1 text-[10px] text-slate-500">loading next page...</div>` : nothing}
              ${!this.filesHasMore && !this.filesLoading ? html`<div class="px-2 py-1 text-[10px] text-slate-600">end of list</div>` : nothing}
            `
          : this.filesLoading
            ? html`<div class="p-2 text-[11px] text-slate-500">file loading...</div>`
            : html`<div class="p-2 text-[11px] text-slate-500">No files match the current filters.</div>`}
      </div>
    `;
  }

  private renderEntriesSidebar(options: {
    title: string;
    countLabel: string;
    showFilterButtons: boolean;
  }) {
    return html`
      <div class="border-b border-chrome-800 p-2 pb-1">
        <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500">
          <span>${options.title}</span>
          <span>${options.countLabel}</span>
        </div>
        ${options.showFilterButtons
          ? html`
              <div class="mb-1 flex items-center gap-1 text-[10px]">
                ${this.renderFilterButton("all", "ALL")}
                ${this.renderFilterButton("java", "JAVA")}
                ${this.renderFilterButton("jsp", "JSP")}
                ${this.renderFilterButton("entry", "ENTRIES")}
              </div>
            `
          : nothing}
        <div class="text-[10px] text-slate-500">Entries load in pages as you scroll.</div>
      </div>
      ${this.renderEntryListPanel()}
    `;
  }

  private renderTreeModeButton(mode: ProjectionTreeMode, label: string) {
    const active = this.treeMode === mode;
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
        @click=${() => {
          this.treeMode = mode;
          this.expandedTreeKeys = [];
          void this.refreshTreeRoot();
          this.statusMessage = `${label} tree selected`;
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderTreeNode(node: ProjectionTreeNode, depth: number): TemplateResult {
    const expanded = node.kind === "branch" && this.expandedTreeKeys.includes(node.id);
    const active = node.kind === "file" && node.file?.path === this.selectedPath;
    const rowClass = active
      ? "grid min-w-0 grid-cols-[1rem_auto_minmax(0,1fr)_auto] items-center gap-1 rounded border border-accent-500 bg-chrome-800 px-2 py-1 text-left shadow-insetline"
      : "grid min-w-0 grid-cols-[1rem_auto_minmax(0,1fr)_auto] items-center gap-1 rounded border border-transparent bg-transparent px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900";
    const paddingLeft = `${depth * 0.9 + 0.25}rem`;
    const childNodes = this.treeNodesByParent[node.id] ?? [];
    const loadingChildren = this.treeLoadingParentIds.includes(node.id);

    return html`
      <div>
        <button
          class=${rowClass}
          style=${`padding-left: ${paddingLeft};`}
          @click=${() => {
            if (node.kind === "branch") {
              void this.toggleTreeNode(node);
              return;
            }

            if (node.file) {
              this.selectFile(node.file, `${node.file.path} selected from ${this.treeMode} tree`);
            }
          }}
        >
          <span class="text-[10px] text-slate-500">${node.kind === "branch" ? expanded ? "-" : "+" : ""}</span>
          ${node.kind === "file"
            ? html`<span class=${node.file?.nodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[9px] uppercase text-accent-500" : "rounded bg-emerald-950 px-1 py-0.5 text-[9px] uppercase text-accent-400"}>${node.file?.nodeType}</span>`
            : html`<span class="rounded bg-chrome-800 px-1 py-0.5 text-[9px] uppercase text-slate-500">${this.treeMode === "classpath" ? "pkg" : "dir"}</span>`}
          <span class="min-w-0 truncate font-mono text-[11px] ${node.kind === "file" ? "text-slate-100" : "text-slate-300"}">${node.label}</span>
          <span class="text-[10px] text-slate-500">${node.fileCount}</span>
        </button>
        ${node.kind === "branch" && expanded
          ? html`
              <div class="grid gap-0.5">
                ${childNodes.map((child) => this.renderTreeNode(child, depth + 1))}
                ${loadingChildren ? html`<div class="px-2 py-1 text-[10px] text-slate-500" style=${`padding-left: ${(depth + 1) * 0.9 + 1.25}rem;`}>loading...</div>` : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderEntryListPanel() {
    return html`
      <div
        class="min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1"
        @scroll=${this.onEntrySidebarScroll}
      >
        ${this.entries.length > 0
          ? html`
              ${virtualize({
                items: this.entries,
                scroller: true,
                renderItem: (entry) => this.renderEntryRow(entry)
              })}
              ${this.entriesLoading ? html`<div class="px-2 py-1 text-[10px] text-slate-500">loading next page...</div>` : nothing}
              ${!this.entriesHasMore && !this.entriesLoading ? html`<div class="px-2 py-1 text-[10px] text-slate-600">end of list</div>` : nothing}
            `
          : this.entriesLoading
            ? html`<div class="p-2 text-[11px] text-slate-500">entry loading...</div>`
            : html`<div class="rounded border border-chrome-800 px-2 py-2 text-[10px] text-slate-500">No analyzed entries were found.</div>`}
      </div>
    `;
  }

  private renderGraphWorkspace(options: {
    title: string;
    subtitle: string;
    emptyMessage: string;
  }) {
    return html`
      <section class="grid min-h-0 min-w-0 grid-rows-[2.5rem_minmax(0,1fr)] overflow-hidden bg-chrome-950">
        <div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1 border-b border-chrome-800 px-2 text-[11px]">
          <div class="min-w-0">
            <div class="truncate font-mono text-[11px] text-slate-200">${options.title}</div>
            <div class="truncate text-[10px] text-slate-500">${options.subtitle}</div>
          </div>
          <div class="flex items-center gap-1 rounded border border-chrome-800 bg-chrome-900 px-1 py-1 text-[10px]">
            <button
              class=${this.graphMode === "dependency"
                ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
                : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
              @click=${() => {
                this.graphMode = "dependency";
                this.clearAstSelection();
              }}
            >
              DEPENDENCY
            </button>
            <button
              class=${this.graphMode === "ast"
                ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
                : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
              @click=${() => {
                this.graphMode = "ast";
                this.clearAstSelection();
                this.selectedGraphNodeId = this.selectedPath;
              }}
            >
              AST
            </button>
          </div>
          ${this.graphMode === "dependency"
            ? html`
                <div class="flex items-center gap-1">
                  <div class="flex items-center gap-1 rounded border border-chrome-800 bg-chrome-900 px-1 py-1 text-[10px]">
                    <span class="px-1 uppercase tracking-[0.16em] text-slate-500">edges</span>
                    ${GRAPH_EDGE_KIND_OPTIONS.map((option) =>
                      this.renderDependencyEdgeKindButton(option.id, option.label)
                    )}
                  </div>
                  <div class="rounded border border-chrome-800 bg-chrome-900 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    cycle-safe
                  </div>
                  <label class="flex items-center gap-1 rounded border border-chrome-800 bg-chrome-900 px-2 py-1 text-[10px] text-slate-300">
                    <span class="uppercase tracking-[0.16em] text-slate-500">max nodes</span>
                    <input
                      type="number"
                      min=${String(MIN_GRAPH_MAX_NODES)}
                      step="10"
                      inputmode="numeric"
                      class="w-20 bg-transparent text-right outline-none"
                      .value=${String(this.graphMaxNodes)}
                      @change=${this.onGraphMaxNodesChange}
                    />
                  </label>
                </div>
              `
            : html`
                <div class="flex items-center gap-1">
                  <div class="flex items-center gap-1 rounded border border-chrome-800 bg-chrome-900 px-1 py-1 text-[10px]">
                    <span class="px-1 uppercase tracking-[0.16em] text-slate-500">layout</span>
                    ${this.renderAstLayoutButton("force", "FORCE")}
                    ${this.renderAstLayoutButton("tree", "TREE")}
                  </div>
                  <label class="flex items-center gap-2 rounded border border-chrome-800 bg-chrome-900 px-2 py-1 text-[10px] text-slate-300">
                    <input
                      type="checkbox"
                      class="accent-sky-500"
                      .checked=${this.includeExternalAst}
                      @change=${(event: Event) => {
                        this.includeExternalAst = (event.target as HTMLInputElement).checked;
                      }}
                    />
                    <span>external AST</span>
                  </label>
                </div>
              `}
          <button class="rounded border border-chrome-800 bg-chrome-900 px-2 py-1 text-slate-300 hover:border-accent-500" @click=${this.resetGraphSelection}>
            reset
          </button>
        </div>
        <div class="min-h-0 p-1">
          ${this.graphMode === "dependency"
            ? this.graphTask.render({
                pending: () => html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">Building graph...</div>`,
                complete: (graph) => graph
                  ? html`<projection-dependency-graph
                      .graph=${graph}
                      .selectedNodeId=${this.selectedGraphNodeId || graph.focusPath}
                      .theme=${this.theme}
                      @projection-node-select=${this.onGraphNodeSelect}
                    ></projection-dependency-graph>`
                  : html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">${options.emptyMessage}</div>`,
                error: (error) => html`<div class="flex h-full items-center justify-center text-[11px] text-red-300">${String(error)}</div>`
              })
            : this.astGraphTask.render({
                pending: () => html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">Building AST graph...</div>`,
                complete: (graph) => graph
                  ? html`<projection-ast-graph
                      .graph=${graph}
                      .layout=${this.astLayout}
                      .selectedNodeId=${this.selectedAstNodeId}
                      .theme=${this.theme}
                      @projection-ast-node-select=${this.onAstNodeSelect}
                    ></projection-ast-graph>`
                  : html`<div class="flex h-full items-center justify-center text-[11px] text-slate-500">${options.emptyMessage}</div>`,
                error: (error) => html`<div class="flex h-full items-center justify-center text-[11px] text-red-300">${String(error)}</div>`
              })}
        </div>
      </section>
    `;
  }

  private renderFilterButton(filter: "all" | "java" | "jsp" | "entry", label: string) {
    const active = this.filter === filter;
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
        @click=${() => {
          void this.onFilterSelected(filter, label);
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderAstLayoutButton(layout: ProjectionAstLayout, label: string) {
    const active = this.astLayout === layout;
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
        @click=${() => {
          this.astLayout = layout;
          this.statusMessage = `AST ${label.toLowerCase()} layout selected`;
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderDependencyEdgeKindButton(kind: ProjectionDependencyEdgeKind, label: string) {
    const active = this.graphEdgeKinds.includes(kind);
    return html`
      <button
        class=${active
          ? "rounded border border-accent-500 bg-chrome-800 px-2 py-1 font-semibold text-slate-100"
          : "rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-slate-400 hover:border-chrome-600"}
        @click=${() => {
          this.toggleGraphEdgeKind(kind);
        }}
      >
        ${label}
      </button>
    `;
  }

  private renderResizeHandle(side: SidebarEdge) {
    const active = this.resizingSidebar === side;
    return html`
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label=${side === "left" ? "Resize left sidebar" : "Resize right sidebar"}
        class=${active
          ? "relative cursor-col-resize bg-accent-500/40 touch-none"
          : "relative cursor-col-resize bg-chrome-800/90 touch-none hover:bg-chrome-700"}
        @pointerdown=${(event: PointerEvent) => {
          this.startSidebarResize(side, event);
        }}
      >
        <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-chrome-700"></div>
      </div>
    `;
  }

  private renderFileRow(file: ProjectionFileEntry) {
    const active = file.path === this.selectedPath;
    return html`
      <button
        class=${active
          ? "mb-1 grid w-[calc(100%-0.5rem)] min-w-0 box-border gap-0.5 rounded border border-accent-500 bg-chrome-800 px-2 py-1 text-left shadow-insetline"
          : "mb-1 grid w-[calc(100%-0.5rem)] min-w-0 box-border gap-0.5 rounded border border-transparent bg-transparent px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900"}
        @click=${() => {
          this.selectFile(file, `${file.path} selected`);
        }}
      >
        <div class="flex min-w-0 items-center gap-1">
          <span class=${file.nodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[10px] text-accent-500" : "rounded bg-emerald-950 px-1 py-0.5 text-[10px] text-accent-400"}>${file.nodeType}</span>
          <span class="truncate font-mono text-[11px] text-slate-100">${file.path.split("/").at(-1)}</span>
        </div>
        <div class="min-w-0 truncate text-[10px] text-slate-400">${this.classpathForFile(file)}</div>
        <div class="min-w-0 truncate font-mono text-[10px] text-slate-500">${file.path}</div>
        <div class="flex min-w-0 items-center gap-2 text-[10px] text-slate-400">
          <span>out ${file.referenceCount}</span>
          <span>in ${file.dependantCount}</span>
          ${file.classCount !== undefined ? html`<span>methods ${file.methodCount ?? 0}</span>` : html`<span>tags ${file.tagCount ?? 0}</span>`}
        </div>
      </button>
    `;
  }

  private renderEntryRow(entry: ProjectionEntry) {
    const active = entry.id === this.selectedEntryId;
    const canFocus = entry.source === "declared" || (Boolean(entry.focusPath) && !entry.disabled);
    const focusLabel = entry.focusPath ? entry.focusPath.split("/").at(-1) : "unmatched";
    const sourceLabel = entry.source === "declared" ? "declared" : "matched";
    return html`
      <button
        class=${active
          ? "grid w-[calc(100%-0.5rem)] min-w-0 box-border gap-0.5 rounded border border-accent-500 bg-chrome-800 px-2 py-1 text-left shadow-insetline"
          : "grid w-[calc(100%-0.5rem)] min-w-0 box-border gap-0.5 rounded border border-chrome-800 bg-chrome-950 px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900"}
        ?disabled=${!canFocus}
        @click=${() => {
          this.clearAstSelection();
          if (!entry.focusPath && entry.source !== "declared") {
            this.selectedEntryId = entry.id;
            this.selectedGraphNodeId = this.defaultGraphNodeId(entry);
            this.statusMessage = `${entry.label} has no matched focus path`;
            return;
          }

          this.selectedEntryId = entry.id;
          this.selectedPath = entry.focusPath ?? this.selectedPath;
          this.selectedGraphNodeId = this.defaultGraphNodeId(entry);
          this.statusMessage = `${entry.label} entry selected`;
        }}
      >
        <div class="flex min-w-0 items-center gap-1">
          <span class=${entry.source === "declared" ? "rounded bg-indigo-950 px-1 py-0.5 text-[9px] uppercase text-indigo-300" : "rounded bg-amber-950 px-1 py-0.5 text-[9px] uppercase text-amber-300"}>${sourceLabel}</span>
          ${entry.entryType ? html`<span class="rounded bg-chrome-700 px-1 py-0.5 text-[9px] uppercase text-slate-200">${entry.entryType}</span>` : nothing}
          ${entry.focusNodeType
            ? html`<span class=${entry.focusNodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[9px] uppercase text-accent-500" : "rounded bg-emerald-950 px-1 py-0.5 text-[9px] uppercase text-accent-400"}>${entry.focusNodeType}</span>`
            : nothing}
          ${entry.variantOf ? html`<span class="rounded bg-chrome-700 px-1 py-0.5 text-[9px] uppercase text-slate-300">variant</span>` : nothing}
        </div>
        <div class="min-w-0 truncate text-[11px] font-semibold text-slate-100">${entry.label}</div>
        <div class="min-w-0 truncate font-mono text-[10px] text-slate-500">${focusLabel}</div>
        <div class="flex min-w-0 items-center gap-2 text-[10px] text-slate-400">
          <span>reach ${entry.reachableCount}</span>
          <span>edges ${entry.edgeCount}</span>
          <span>seeds ${entry.seedPaths.length}</span>
        </div>
      </button>
    `;
  }

  private renderEntryDetail(entry: ProjectionEntry) {
    return html`
      <div class="grid gap-2">
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 flex flex-wrap items-center gap-1">
            <span class=${entry.source === "declared" ? "rounded bg-indigo-950 px-1 py-0.5 text-[9px] uppercase text-indigo-300" : "rounded bg-amber-950 px-1 py-0.5 text-[9px] uppercase text-amber-300"}>${entry.source}</span>
            ${entry.entryType ? html`<span class="rounded bg-chrome-700 px-1 py-0.5 text-[9px] uppercase text-slate-200">${entry.entryType}</span>` : nothing}
            ${entry.focusNodeType ? html`<span class=${entry.focusNodeType === "jsp" ? "rounded bg-sky-950 px-1 py-0.5 text-[9px] uppercase text-accent-500" : "rounded bg-emerald-950 px-1 py-0.5 text-[9px] uppercase text-accent-400"}>${entry.focusNodeType}</span>` : nothing}
            ${entry.variantOf ? html`<span class="rounded bg-chrome-700 px-1 py-0.5 text-[9px] uppercase text-slate-300">variant of ${entry.variantOf}</span>` : nothing}
          </div>
          <div class="break-words text-[12px] font-semibold text-slate-100">${entry.label}</div>
          <div class="break-all font-mono text-[10px] text-slate-500">${entry.id}</div>
          ${entry.description ? html`<p class="mt-2 break-words text-[10px] leading-5 text-slate-300">${entry.description}</p>` : nothing}
          <div class="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            <div class="rounded border border-chrome-800 px-2 py-1">reach ${entry.reachableCount}</div>
            <div class="rounded border border-chrome-800 px-2 py-1">edges ${entry.edgeCount}</div>
            <div class="rounded border border-chrome-800 px-2 py-1">nodes ${entry.nodeCount}</div>
            <div class="rounded border border-chrome-800 px-2 py-1">seeds ${entry.seedPaths.length}</div>
          </div>
          ${entry.focusPath
            ? html`
                <button
                  class="mt-2 rounded border border-accent-500 px-2 py-1 text-[10px] font-semibold text-accent-500 hover:bg-chrome-900"
                  @click=${() => {
                    this.clearAstSelection();
                    this.activeTab = "dependency-tree";
                    this.filter = "all";
                    this.selectedPath = entry.focusPath ?? this.selectedPath;
                    this.selectedGraphNodeId = entry.focusPath ?? this.selectedGraphNodeId;
                    void this.refreshDependencyFiles();
                    this.statusMessage = `${entry.label} opened in dependency tree`;
                  }}
                >
                  open in dependency tree
                </button>
              `
            : nothing}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Focus Path</div>
          ${entry.focusPath
            ? html`<div class="whitespace-pre-wrap break-all rounded border border-chrome-800 px-2 py-1 font-mono text-[10px] text-slate-200">${entry.focusPath}</div>`
            : html`<div class="text-[10px] text-slate-500">No matched focus path.</div>`}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Tags</div>
          ${entry.tags.length > 0
            ? html`<div class="flex flex-wrap gap-1">${entry.tags.map((tag) => html`<span class="rounded border border-chrome-700 px-2 py-0.5 text-[10px] text-slate-300">${tag}</span>`)}</div>`
            : html`<div class="text-[10px] text-slate-500">None</div>`}
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Seed Paths</div>
          <div class="grid gap-1">
            ${entry.seedPaths.map((seedPath) => html`<div class="whitespace-pre-wrap break-all rounded border border-chrome-800 px-2 py-1 font-mono text-[10px] text-slate-300">${seedPath}</div>`)}
          </div>
        </section>
        <section class="rounded border border-chrome-800 bg-chrome-950 px-2 py-1">
          <div class="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Matched By</div>
          ${entry.matchedBy.length > 0
            ? html`<div class="grid gap-1">${entry.matchedBy.map((value) => html`<div class="whitespace-pre-wrap break-all rounded border border-chrome-800 px-2 py-1 font-mono text-[10px] text-slate-300">${value}</div>`)}</div>`
            : html`<div class="text-[10px] text-slate-500">No entry-file pattern for this entry.</div>`}
        </section>
      </div>
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
          <div class="break-all font-mono text-[11px] text-slate-100">${file.path}</div>
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
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Source</span>
            <span class="rounded border border-chrome-800 px-1 py-0.5 text-[10px] text-slate-400">
              ${detail.source?.language === "jsp" ? "jsp/html" : detail.source?.language ?? "unavailable"}
            </span>
          </div>
          ${detail.source
            ? html`
                <div class="mb-1 break-all font-mono text-[10px] text-slate-500">${detail.source.path}</div>
                ${detail.source.truncated
                  ? html`<div class="mb-1 rounded border border-amber-900 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-200">Source preview truncated to ${detail.source.content.length.toLocaleString()} characters.</div>`
                  : nothing}
                <projection-source-viewer
                  .value=${detail.source.content}
                  .language=${detail.source.language}
                  .theme=${this.theme}
                  .highlightLocation=${this.sourceHighlight?.path === detail.file.path ? this.sourceHighlight.location : undefined}
                ></projection-source-viewer>
              `
            : html`<div class="text-[10px] text-slate-500">Source unavailable for this node.</div>`}
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
    if (file.nodeType === "unresolved" || file.nodeType === "entry" || file.path === this.selectedPath) {
      return nothing;
    }

    return html`
      <button
        class="mt-2 rounded border border-accent-500 px-2 py-1 text-[10px] font-semibold text-accent-500 hover:bg-chrome-900"
        @click=${() => {
          this.selectFile(file, `${file.path} focus moved`);
        }}
      >
        focus in graph
      </button>
    `;
  }

  private renderReferenceTable(items: ProjectionFileDetail["references"]) {
    if (items.length === 0) {
      return html`<div class="text-[10px] text-slate-500">None</div>`;
    }

    return html`
      <div class="grid gap-1">
        ${items.slice(0, 20).map((item) => html`
          <button
            class="rounded border border-chrome-800 px-2 py-1 text-left hover:border-chrome-700 hover:bg-chrome-900"
            @click=${() => {
              this.clearAstSelection();
              this.selectedGraphNodeId = item.path;
              this.statusMessage = `${item.path} detail selected`;
            }}
          >
            <div class="whitespace-pre-wrap break-all font-mono text-[10px] text-slate-100">${item.path}</div>
            <div class="whitespace-pre-wrap break-all text-[10px] text-slate-500">${item.edgeTypes.join(", ")} · ${item.symbols.slice(0, 2).join(", ")}</div>
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
          ? html`<div class="grid gap-1">${items.slice(0, limit).map((item) => html`<div class="whitespace-pre-wrap break-all rounded border border-chrome-800 px-2 py-1 font-mono text-[10px] text-slate-300">${item}</div>`)}</div>`
          : html`<div class="text-[10px] text-slate-500">None</div>`}
      </div>
    `;
  }

  private async onTabSelected(tabId: string, label: string) {
    this.activeTab = tabId;
    this.clearAstSelection();
    if (tabId === "entries") {
      await this.ensureEntryListReady();
      if (this.selectedEntry) {
        this.selectedPath = this.selectedEntry.focusPath ?? this.selectedPath;
        this.selectedGraphNodeId = this.defaultGraphNodeId(this.selectedEntry);
      }
      this.statusMessage = `${label} tab selected`;
      return;
    }

    if (tabId === "tree-view") {
      if (this.filter === "entry") {
        this.filter = "all";
      }
      this.selectedGraphNodeId = this.selectedPath;
      await this.refreshTreeRoot();
      this.statusMessage = `${label} tab selected`;
      return;
    }

    this.selectedGraphNodeId = this.isEntryFilter && this.selectedEntry
      ? this.defaultGraphNodeId(this.selectedEntry)
      : this.selectedPath;
    await this.refreshActiveData();
    this.statusMessage = `${label} tab selected`;
  }

  private async onFilterSelected(filter: "all" | "java" | "jsp" | "entry", label: string) {
    this.filter = filter;
    this.clearAstSelection();

    if (filter === "entry") {
      await this.ensureEntryListReady();
      if (this.selectedEntry) {
        this.selectedPath = this.selectedEntry.focusPath ?? this.selectedPath;
        this.selectedGraphNodeId = this.defaultGraphNodeId(this.selectedEntry);
      }
      this.statusMessage = "Entries filter selected";
      return;
    }

    this.selectedGraphNodeId = this.selectedPath;
    if (this.activeTab === "tree-view") {
      await this.refreshTreeRoot();
    } else {
      await this.refreshDependencyFiles();
    }
    this.statusMessage = `${label} filter selected`;
  }

  private async refreshActiveData() {
    if (this.isEntryFilter || this.activeTab === "entries") {
      await this.ensureEntryListReady();
      return;
    }

    if (this.activeTab === "tree-view") {
      await this.refreshTreeRoot();
      return;
    }

    await this.refreshDependencyFiles();
  }

  private async ensureEntryListReady(signal?: AbortSignal) {
    if (this.entriesLoading) {
      return;
    }

    if (this.entriesReady) {
      if (this.selectedEntryId) {
        await this.ensureEntryLoaded({ id: this.selectedEntryId }, signal);
      }
      return;
    }

    await this.refreshEntries(signal);
  }

  private async refreshEntries(signal?: AbortSignal) {
    const version = ++this.entriesQueryVersion;
    this.entries = [];
    this.entriesTotal = this.bootstrap?.counts.entries ?? 0;
    this.entriesReady = false;
    this.entriesHasMore = true;
    this.entriesLoading = false;
    await this.loadNextEntriesPage(version, true, signal);
    if (this.selectedEntryId) {
      await this.ensureEntryLoaded({ id: this.selectedEntryId }, signal);
    }
    if (!this.selectedEntryId && this.entries[0]) {
      this.selectedEntryId = this.entries[0].id;
      this.selectedGraphNodeId = this.defaultGraphNodeId(this.entries[0]);
    }
  }

  private async loadNextEntriesPage(version = this.entriesQueryVersion, reset = false, signal?: AbortSignal) {
    if (this.entriesLoading || (this.entriesHasMore === false && !reset)) {
      return;
    }

    this.entriesLoading = true;
    const offset = reset ? 0 : this.entries.length;

    try {
      const page = await fetchEntriesPage({
        offset,
        limit: ENTRY_PAGE_SIZE
      }, signal);

      if (version !== this.entriesQueryVersion) {
        return;
      }

      this.cacheEntries(page.entries);
      this.entries = reset ? page.entries : [...this.entries, ...page.entries];
      this.entriesTotal = page.total;
      this.entriesReady = true;
      this.entriesHasMore = page.hasMore;
    } catch (error) {
      if (version === this.entriesQueryVersion && !signal?.aborted) {
        this.statusMessage = `entry list error: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (version === this.entriesQueryVersion) {
        this.entriesLoading = false;
      }
    }
  }

  private async ensureEntryLoaded(
    options: {
      id?: string;
      focusPath?: string;
    },
    signal?: AbortSignal
  ): Promise<ProjectionEntry | undefined> {
    if (options.id) {
      const cached = this.entryCacheById.get(options.id);
      if (cached) {
        return cached;
      }
    }

    if (options.focusPath) {
      const cached = [...this.entryCacheById.values()].find((entry) => entry.focusPath === options.focusPath);
      if (cached) {
        return cached;
      }
    }

    try {
      const { entry } = await fetchEntryDetail(options, signal);
      this.cacheEntries([entry]);
      return entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.focusPath && (message.includes("Entry not found") || message.startsWith("404 "))) {
        return undefined;
      }
      if (!signal?.aborted) {
        this.statusMessage = `entry detail error: ${message}`;
      }
      return undefined;
    }
  }

  private async refreshDependencyFiles() {
    const version = ++this.filesQueryVersion;
    this.files = [];
    this.filesTotal = 0;
    this.filesHasMore = true;
    this.filesLoading = false;
    if (this.isEntryFilter) {
      return;
    }
    await this.loadNextFilesPage(version, true);
  }

  private async loadNextFilesPage(version = this.filesQueryVersion, reset = false) {
    if (this.filesLoading || (this.filesHasMore === false && !reset) || this.isEntryFilter) {
      return;
    }

    this.filesLoading = true;
    const offset = reset ? 0 : this.files.length;

    try {
      const page = await fetchFilesPage({
        offset,
        limit: FILE_PAGE_SIZE,
        nodeType: this.treeNodeTypeFilter,
        search: this.search || undefined,
        classpathPrefix: this.classpathFilter || undefined
      });

      if (version !== this.filesQueryVersion) {
        return;
      }

      this.cacheFiles(page.files);
      this.files = reset ? page.files : [...this.files, ...page.files];
      this.filesTotal = page.total;
      this.filesHasMore = page.hasMore;
    } catch (error) {
      if (version === this.filesQueryVersion) {
        this.statusMessage = `file list error: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (version === this.filesQueryVersion) {
        this.filesLoading = false;
      }
    }
  }

  private async refreshTreeRoot() {
    const version = ++this.treeQueryVersion;
    const previousExpandedTreeKeys = [...this.expandedTreeKeys];
    this.treeNodesByParent = {};
    this.treeLoadedParentIds = [];
    this.treeLoadingParentIds = [ROOT_TREE_PARENT];
    this.treeRootLoading = true;
    this.treeTotalFiles = 0;

    try {
      const response = await fetchTreeNodes({
        mode: this.treeMode,
        nodeType: this.treeNodeTypeFilter,
        search: this.search || undefined
      });

      if (version !== this.treeQueryVersion) {
        return;
      }

      this.cacheFiles(response.nodes.flatMap((node) => node.file ? [node.file] : []));
      this.treeNodesByParent = { [ROOT_TREE_PARENT]: response.nodes };
      this.treeLoadedParentIds = [ROOT_TREE_PARENT];
      this.treeLoadingParentIds = [];
      this.treeTotalFiles = response.totalFiles;
      this.treeRootLoading = false;
      this.expandedTreeKeys = [];

      await this.restoreExpandedTreeBranches(previousExpandedTreeKeys, version);

      if (this.selectedPath) {
        await this.ensureTreePathLoaded(this.selectedPath, version);
      }
    } catch (error) {
      if (version === this.treeQueryVersion) {
        this.treeRootLoading = false;
        this.treeLoadingParentIds = [];
        this.statusMessage = `tree error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  private async toggleTreeNode(node: ProjectionTreeNode) {
    if (this.expandedTreeKeys.includes(node.id)) {
      this.expandedTreeKeys = this.expandedTreeKeys.filter((key) => key !== node.id);
      return;
    }

    this.expandedTreeKeys = [...this.expandedTreeKeys, node.id];
    await this.loadTreeChildren(node.id);
  }

  private async loadTreeChildren(parentId: string, version = this.treeQueryVersion) {
    if (this.treeLoadedParentIds.includes(parentId) || this.treeLoadingParentIds.includes(parentId)) {
      return;
    }

    this.treeLoadingParentIds = [...this.treeLoadingParentIds, parentId];

    try {
      const response = await fetchTreeNodes({
        mode: this.treeMode,
        parentId,
        nodeType: this.treeNodeTypeFilter,
        search: this.search || undefined
      });

      if (version !== this.treeQueryVersion) {
        return;
      }

      this.cacheFiles(response.nodes.flatMap((node) => node.file ? [node.file] : []));
      this.treeNodesByParent = { ...this.treeNodesByParent, [parentId]: response.nodes };
      this.treeLoadedParentIds = [...new Set([...this.treeLoadedParentIds, parentId])];
    } catch (error) {
      if (version === this.treeQueryVersion) {
        this.statusMessage = `tree branch error: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (version === this.treeQueryVersion) {
        this.treeLoadingParentIds = this.treeLoadingParentIds.filter((id) => id !== parentId);
      }
    }
  }

  private async restoreExpandedTreeBranches(branchIds: string[], version = this.treeQueryVersion) {
    const restored: string[] = [];
    const orderedBranchIds = [...new Set(branchIds)].sort((left, right) => this.treeBranchDepth(left) - this.treeBranchDepth(right));

    for (const branchId of orderedBranchIds) {
      const parentId = this.parentTreeBranchId(branchId) ?? ROOT_TREE_PARENT;
      const siblings = parentId === ROOT_TREE_PARENT
        ? this.rootTreeNodes
        : this.treeNodesByParent[parentId] ?? [];
      const branch = siblings.find((node) => node.id === branchId && node.kind === "branch");
      if (!branch) {
        continue;
      }

      restored.push(branchId);
      await this.loadTreeChildren(branchId, version);
    }

    if (version === this.treeQueryVersion) {
      this.expandedTreeKeys = restored;
    }
  }

  private async ensureTreePathLoaded(path: string, version = this.treeQueryVersion) {
    if (!path) {
      return;
    }

    try {
      const response = await fetchTreeAncestors(path, this.treeMode);
      if (version !== this.treeQueryVersion) {
        return;
      }

      this.expandedTreeKeys = [...new Set([...this.expandedTreeKeys, ...response.branchIds])];
      for (const branchId of response.branchIds) {
        await this.loadTreeChildren(branchId, version);
      }
    } catch {
      // Keep tree usable even when the selected file is outside the current filter.
    }
  }

  private cacheFiles(files: ProjectionFileEntry[]) {
    let changed = false;
    for (const file of files) {
      const current = this.fileCacheByPath.get(file.path);
      if (current !== file) {
        this.fileCacheByPath.set(file.path, file);
        changed = true;
      }
    }
    if (changed) {
      this.requestUpdate();
    }
  }

  private cacheEntries(entries: ProjectionEntry[]) {
    let changed = false;
    for (const entry of entries) {
      const current = this.entryCacheById.get(entry.id);
      if (current !== entry) {
        this.entryCacheById.set(entry.id, entry);
        changed = true;
      }
    }
    if (changed) {
      this.requestUpdate();
    }
  }

  private selectFile(file: ProjectionFileEntry, statusMessage: string) {
    this.cacheFiles([file]);
    this.clearAstSelection();
    this.selectedPath = file.path;
    this.selectedGraphNodeId = file.path;
    void this.syncEntrySelectionForFile(file.path);
    if (this.activeTab === "tree-view") {
      void this.ensureTreePathLoaded(file.path);
    }
    this.statusMessage = statusMessage;
  }

  private async syncEntrySelectionForFile(path: string) {
    const entry = await this.ensureEntryLoaded({ focusPath: path });
    if (!entry || this.selectedPath !== path) {
      return;
    }
    this.selectedEntryId = entry.id;
  }

  private parentTreeBranchId(branchId: string): string | undefined {
    const [prefix, pathPart] = branchId.split(":branch:");
    if (!pathPart) {
      return undefined;
    }
    const segments = pathPart.split("/").filter(Boolean);
    if (segments.length <= 1) {
      return undefined;
    }
    return `${prefix}:branch:${segments.slice(0, -1).join("/")}`;
  }

  private treeBranchDepth(branchId: string): number {
    const [, pathPart = ""] = branchId.split(":branch:");
    return pathPart.split("/").filter(Boolean).length;
  }

  private onFileSidebarScroll = (event: Event) => {
    if (this.isEntryFilter || this.filesLoading || !this.filesHasMore) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - FILE_SCROLL_THRESHOLD) {
      void this.loadNextFilesPage();
    }
  };

  private onGraphMaxNodesChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const parsed = Number.parseInt(target.value, 10);
    const nextMaxNodes = Number.isFinite(parsed) ? Math.max(MIN_GRAPH_MAX_NODES, parsed) : this.graphMaxNodes;
    this.graphMaxNodes = nextMaxNodes;
    target.value = String(nextMaxNodes);
    this.statusMessage = `max nodes ${nextMaxNodes}`;
  };

  private toggleGraphEdgeKind(kind: ProjectionDependencyEdgeKind) {
    const nextKinds = this.graphEdgeKinds.includes(kind)
      ? this.graphEdgeKinds.filter((entry) => entry !== kind)
      : [...this.graphEdgeKinds, kind];
    if (nextKinds.length === 0) {
      return;
    }
    this.graphEdgeKinds = GRAPH_EDGE_KIND_OPTIONS
      .map((option) => option.id)
      .filter((entry) => nextKinds.includes(entry));
    this.statusMessage = `edge filters ${this.graphEdgeKinds.join(", ")}`;
  }

  private onEntrySidebarScroll = (event: Event) => {
    if (this.entriesLoading || !this.entriesHasMore) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - ENTRY_SCROLL_THRESHOLD) {
      void this.loadNextEntriesPage();
    }
  };

  private onViewportResize = () => {
    this.syncSidebarWidths();
  };

  private onSidebarResizeMove = (event: PointerEvent) => {
    if (!this.resizeSession) {
      return;
    }

    const layoutWidth = this.layoutElement?.clientWidth ?? 0;
    if (!layoutWidth) {
      return;
    }

    const deltaX = event.clientX - this.resizeSession.startX;
    const minSidebarWidth = this.sidebarMinWidth(layoutWidth);
    const maxLeftWidth = Math.max(
      minSidebarWidth,
      layoutWidth - (this.resizeHandleWidth * 2) - this.rightSidebarWidth - this.minCenterWidth
    );
    const maxRightWidth = Math.max(
      minSidebarWidth,
      layoutWidth - (this.resizeHandleWidth * 2) - this.leftSidebarWidth - this.minCenterWidth
    );

    if (this.resizeSession.side === "left") {
      const nextWidth = this.clampWidth(this.resizeSession.startLeftWidth + deltaX, minSidebarWidth, maxLeftWidth);
      if (nextWidth !== this.leftSidebarWidth) {
        this.leftSidebarWidth = nextWidth;
      }
      return;
    }

    const nextWidth = this.clampWidth(this.resizeSession.startRightWidth - deltaX, minSidebarWidth, maxRightWidth);
    if (nextWidth !== this.rightSidebarWidth) {
      this.rightSidebarWidth = nextWidth;
    }
  };

  private onSidebarResizeEnd = () => {
    if (!this.resizeSession) {
      return;
    }

    this.stopSidebarResize();
    this.syncSidebarWidths();
    this.statusMessage = `layout ${this.leftSidebarWidth}px / ${this.rightSidebarWidth}px`;
  };

  private onGraphNodeSelect = (event: CustomEvent<{ nodeId: string }>) => {
    this.clearAstSelection();
    this.selectedGraphNodeId = event.detail.nodeId;
    this.statusMessage = `${event.detail.nodeId} detail selected`;
  };

  private resetGraphSelection = () => {
    this.clearAstSelection();
    this.selectedGraphNodeId = (this.activeTab === "entries" || this.filter === "entry") && this.selectedEntry
      ? this.defaultGraphNodeId(this.selectedEntry)
      : this.selectedPath;
    this.statusMessage = "detail selection reset";
  };

  private onAstNodeSelect = (event: CustomEvent<{ nodeId: string; path: string; location?: ProjectionSourceHighlight["location"] }>) => {
    this.selectedAstNodeId = event.detail.nodeId;
    this.selectedGraphNodeId = event.detail.path || this.selectedGraphNodeId;
    this.sourceHighlight = {
      path: event.detail.path,
      location: event.detail.location
    };
    this.statusMessage = `${event.detail.nodeId} AST selected`;
  };

  private clearAstSelection() {
    this.selectedAstNodeId = "";
    this.sourceHighlight = undefined;
  }

  private classpathForFile(file: ProjectionFileEntry): string {
    if (file.packageName) {
      return file.packageName;
    }

    const parts = file.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : file.path;
  }

  private defaultGraphNodeId(entry: ProjectionEntry): string {
    if (entry.source === "declared") {
      return `entry:${entry.id}`;
    }

    return entry.focusPath ?? this.selectedGraphNodeId;
  }

  private startSidebarResize(side: SidebarEdge, event: PointerEvent) {
    event.preventDefault();
    this.resizeSession = {
      side,
      startX: event.clientX,
      startLeftWidth: this.leftSidebarWidth,
      startRightWidth: this.rightSidebarWidth
    };
    this.resizingSidebar = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", this.onSidebarResizeMove);
    window.addEventListener("pointerup", this.onSidebarResizeEnd);
    window.addEventListener("pointercancel", this.onSidebarResizeEnd);
  }

  private stopSidebarResize() {
    this.resizeSession = undefined;
    this.resizingSidebar = "";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", this.onSidebarResizeMove);
    window.removeEventListener("pointerup", this.onSidebarResizeEnd);
    window.removeEventListener("pointercancel", this.onSidebarResizeEnd);
  }

  private syncSidebarWidths() {
    const layoutWidth = this.layoutElement?.clientWidth ?? 0;
    if (!layoutWidth) {
      return;
    }

    const minSidebarWidth = this.sidebarMinWidth(layoutWidth);
    const maxSidebarTotal = Math.max(
      minSidebarWidth * 2,
      layoutWidth - (this.resizeHandleWidth * 2) - this.minCenterWidth
    );

    let nextLeftWidth = Math.max(minSidebarWidth, this.leftSidebarWidth);
    let nextRightWidth = Math.max(minSidebarWidth, this.rightSidebarWidth);
    const overflow = nextLeftWidth + nextRightWidth - maxSidebarTotal;

    if (overflow > 0) {
      const leftOverflow = Math.min(overflow, Math.max(0, nextLeftWidth - minSidebarWidth));
      nextLeftWidth -= leftOverflow;
      nextRightWidth -= Math.min(
        overflow - leftOverflow,
        Math.max(0, nextRightWidth - minSidebarWidth)
      );
    }

    if (nextLeftWidth !== this.leftSidebarWidth) {
      this.leftSidebarWidth = nextLeftWidth;
    }
    if (nextRightWidth !== this.rightSidebarWidth) {
      this.rightSidebarWidth = nextRightWidth;
    }
  }

  private sidebarMinWidth(layoutWidth: number): number {
    const maxSidebarTotal = Math.max(
      0,
      layoutWidth - (this.resizeHandleWidth * 2) - this.minCenterWidth
    );
    return Math.max(96, Math.min(this.minSidebarWidth, Math.floor(maxSidebarTotal / 2)));
  }

  private clampWidth(width: number, minWidth: number, maxWidth: number): number {
    return Math.round(Math.min(Math.max(width, minWidth), maxWidth));
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

function uniqueTabs(tabs: Array<{ id: string; label: string }>): Array<{ id: string; label: string }> {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.id)) {
      return false;
    }
    seen.add(tab.id);
    return true;
  });
}

customElements.define("leflect-java-projection-app", LeflectJavaProjectionApp);
