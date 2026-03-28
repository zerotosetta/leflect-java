import { LitElement, PropertyValues, html } from "lit";
import * as d3 from "d3";

import type {
  ProjectionGraphEdge,
  ProjectionGraphNode,
  ProjectionGraphResponse,
  ProjectionTheme
} from "../types";

type PositionedNode = ProjectionGraphNode & {
  x: number;
  y: number;
};

type SimNode = PositionedNode & d3.SimulationNodeDatum;
type SimLink = Omit<ProjectionGraphEdge, "sourceId" | "targetId"> & d3.SimulationLinkDatum<SimNode>;
type RenderLink = Omit<ProjectionGraphEdge, "sourceId" | "targetId"> & {
  source: PositionedNode;
  target: PositionedNode;
};

type GraphBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_SCALE = 0.18;
const MAX_SCALE = 2.4;
const MINIMAP_PADDING = 28;
const LABEL_GUTTER = 8;
const LABEL_WIDTH = 240;
const DEFAULT_LAYOUT_TICKS = 220;

class ProjectionDependencyGraph extends LitElement {
  static properties = {
    graph: { attribute: false },
    selectedNodeId: { attribute: false },
    theme: { attribute: false }
  };

  graph?: ProjectionGraphResponse;
  selectedNodeId?: string;
  theme: ProjectionTheme = "dark";

  private svgSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private canvasSelection?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private minimapSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private minimapViewportSelection?: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private simulation?: d3.Simulation<SimNode, undefined>;
  private nodeSelection?: d3.Selection<SVGGElement, PositionedNode, SVGGElement, unknown>;
  private labelSelection?: d3.Selection<SVGTextElement, PositionedNode, SVGGElement, unknown>;
  private currentTransform = d3.zoomIdentity;
  private initialTransform = d3.zoomIdentity;
  private zoomBehavior = d3.zoom<SVGSVGElement, unknown>();
  private graphBounds?: GraphBounds;
  private renderLinks: RenderLink[] = [];
  private positionedNodes: PositionedNode[] = [];

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    const graph = this.graph;

    return html`
      <div class="relative h-full w-full overflow-hidden rounded border border-chrome-800 bg-[rgb(var(--theme-graph-surface))] shadow-insetline">
        <svg class="h-full w-full"></svg>
        ${graph && graph.nodes.length > 0
          ? html`
              <div class="absolute left-2 top-2 z-10 rounded border border-chrome-700 bg-chrome-950/90 px-2 py-1 text-[9px] text-slate-400 backdrop-blur-sm">
                <div class="mb-1 uppercase tracking-[0.18em] text-slate-500">Dependency Force Graph</div>
                <div class="grid gap-1 text-[9px]">
                  <div>nodes ${graph.stats.nodes}</div>
                  <div>edges ${graph.stats.edges}</div>
                  <div>${graph.truncated ? "truncated" : "complete"}</div>
                </div>
              </div>
              <div class="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded border border-chrome-700 bg-chrome-950/90 px-1 py-1 text-[10px] text-slate-300 backdrop-blur-sm">
                <button class="pointer-events-auto rounded border border-chrome-700 px-2 py-1 hover:border-accent-500 hover:text-slate-100" @click=${this.zoomOut}>-</button>
                <span class="min-w-[3.5rem] text-center font-mono text-[10px] text-slate-200" data-zoom-label>100%</span>
                <button class="pointer-events-auto rounded border border-chrome-700 px-2 py-1 hover:border-accent-500 hover:text-slate-100" @click=${this.zoomIn}>+</button>
                <button class="pointer-events-auto rounded border border-chrome-700 px-2 py-1 hover:border-accent-500 hover:text-slate-100" @click=${this.resetZoom}>reset</button>
              </div>
              <div class="absolute bottom-2 right-2 z-10 w-52 rounded border border-chrome-700 bg-chrome-950/90 p-1 text-[9px] text-slate-400 backdrop-blur-sm">
                <div class="mb-1 flex items-center justify-between uppercase tracking-[0.18em]">
                  <span>Minimap</span>
                  <span class="font-mono text-[9px] text-slate-300" data-minimap-zoom>100%</span>
                </div>
                <svg class="block h-32 w-full rounded border border-chrome-800 bg-[rgb(var(--theme-graph-minimap))]" data-minimap></svg>
              </div>
            `
          : null}
        ${graph && graph.nodes.length > 0
          ? null
          : html`<div class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">No outbound dependency graph is available for the selected file.</div>`}
      </div>
    `;
  }

  override firstUpdated(): void {
    const svgElement = this.querySelector("svg");
    if (!svgElement) {
      return;
    }

    this.svgSelection = d3.select(svgElement);
    this.canvasSelection = this.svgSelection.append("g");
    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([MIN_SCALE, MAX_SCALE]).on("zoom", (event) => {
      this.currentTransform = event.transform;
      this.applyTransform();
    });
    this.svgSelection.call(this.zoomBehavior);
    this.refreshOverlayRefs();
    this.drawGraph();
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("graph") || changedProperties.has("theme")) {
      this.refreshOverlayRefs();
      this.drawGraph();
      return;
    }
    if (changedProperties.has("selectedNodeId")) {
      this.updateSelectionStyles();
      this.renderNodeLabels();
    }
  }

  override disconnectedCallback(): void {
    this.simulation?.stop();
    super.disconnectedCallback();
  }

  private refreshOverlayRefs(): void {
    const minimapElement = this.querySelector<SVGSVGElement>("[data-minimap]");
    this.minimapSelection = minimapElement ? d3.select(minimapElement) : undefined;
  }

  private drawGraph(): void {
    this.simulation?.stop();
    if (!this.svgSelection || !this.canvasSelection) {
      return;
    }

    this.svgSelection.selectAll("defs").remove();
    this.canvasSelection.selectAll("*").remove();
    this.clearMinimap();
    this.nodeSelection = undefined;
    this.labelSelection = undefined;
    this.currentTransform = d3.zoomIdentity;
    this.initialTransform = d3.zoomIdentity;
    this.graphBounds = undefined;
    this.renderLinks = [];
    this.positionedNodes = [];

    const graph = this.graph;
    if (!graph || graph.nodes.length === 0) {
      this.applyTransform();
      return;
    }

    const svgNode = this.svgSelection.node();
    if (!svgNode) {
      return;
    }

    const width = Math.max(720, svgNode.getBoundingClientRect().width || 960);
    const height = Math.max(520, svgNode.getBoundingClientRect().height || 720);
    this.svgSelection.attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);
    this.createDefs();

    const nodes: SimNode[] = graph.nodes.map((node, index) => ({
      ...node,
      x: this.initialNodeX(node, index),
      y: this.initialNodeY(node, index)
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.edges
      .map((edge): SimLink | undefined => {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) {
          return undefined;
        }
        return {
          ...edge,
          source,
          target
        };
      })
      .filter((edge): edge is SimLink => edge !== undefined);

    const linkSelection = this.canvasSelection
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.78)
      .attr("stroke-width", 1.25)
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links)
      .join("path")
      .attr("stroke", (edge) => this.linkColor(edge.type))
      .attr("marker-end", "url(#projection-arrow)");

    this.nodeSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("drag", (event, node) => {
            node.x = event.x;
            node.y = event.y;
            this.updateLayout(linkSelection);
          })
      )
      .on("click", (_, node) => {
        this.dispatchEvent(
          new CustomEvent("projection-node-select", {
            detail: { nodeId: node.id },
            bubbles: true,
            composed: true
          })
        );
      });

    this.nodeSelection.append("circle");

    this.labelSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .attr("font-size", 9)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace");

    this.simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance((edge) => this.linkDistance(edge))
          .strength((edge) => this.linkStrength(edge))
      )
      .force("charge", d3.forceManyBody<SimNode>().strength((node) => this.nodeCharge(node)))
      .force("collision", d3.forceCollide<SimNode>().radius((node) => this.nodeRadius(node) + 18))
      .force("x", d3.forceX<SimNode>((node) => this.nodeTargetX(node)).strength(0.34))
      .force("y", d3.forceY<SimNode>((node) => this.nodeTargetY(node)).strength(0.08))
      .force("center", d3.forceCenter(0, 0))
      .stop();

    for (let index = 0; index < DEFAULT_LAYOUT_TICKS; index += 1) {
      this.simulation.tick();
    }

    this.updateLayout(linkSelection);
    this.renderLinks = this.resolveRenderLinks(nodes, graph.edges);
    this.positionedNodes = nodes;
    this.graphBounds = this.measureGraphBounds(nodes);
    this.drawMinimap(nodes, this.renderLinks);
    this.initialTransform = this.defaultTransform();
    this.currentTransform = this.initialTransform;
    this.svgSelection.call(this.zoomBehavior.transform, this.initialTransform);
    this.updateSelectionStyles();
  }

  private createDefs(): void {
    if (!this.svgSelection) {
      return;
    }

    const defs = this.svgSelection.append("defs");
    defs
      .append("marker")
      .attr("id", "projection-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 9)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", this.themeColor("--theme-graph-arrow", "91 119 184"));
  }

  private updateLayout(
    linkSelection: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>
  ): void {
    linkSelection.attr("d", (edge) => this.linkPath({
      source: edge.source as PositionedNode,
      target: edge.target as PositionedNode
    }));
    this.nodeSelection?.attr("transform", (node) => `translate(${node.x},${node.y})`);
    this.renderNodeLabels();
    this.updateMinimap();
  }

  private renderNodeLabels(): void {
    if (!this.labelSelection) {
      return;
    }

    const primaryColor = this.themeColor("--theme-graph-text", "226 232 240");
    const secondaryColor = this.themeColor("--theme-graph-subtitle", "100 116 139");

    this.labelSelection
      .attr("fill", primaryColor)
      .each((node, index, elements) => {
        const text = d3.select(elements[index]);
        const baseX = node.x + this.nodeRadius(node) + LABEL_GUTTER;
        const baseY = node.y - 2;
        const lines = this.nodeLabelLines(node);

        text.attr("x", baseX).attr("y", baseY);
        text.selectAll("tspan").remove();

        lines.forEach((line, lineIndex) => {
          text
            .append("tspan")
            .attr("x", baseX)
            .attr("dy", lineIndex === 0 ? 0 : 10)
            .attr("font-weight", lineIndex === 0 ? 700 : 400)
            .attr("fill", lineIndex === 0 ? primaryColor : secondaryColor)
            .text(line);
        });
      });
  }

  private drawMinimap(nodes: PositionedNode[], links: RenderLink[]): void {
    if (!this.minimapSelection || !this.graphBounds) {
      return;
    }

    const minimap = this.minimapSelection;
    minimap.selectAll("*").remove();
    const bounds = this.graphBounds;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    minimap.attr("viewBox", `${bounds.minX} ${bounds.minY} ${width} ${height}`);

    minimap
      .append("g")
      .attr("fill", "none")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.72)
      .selectAll<SVGPathElement, RenderLink>("path")
      .data(links)
      .join("path")
      .attr("stroke", (edge) => this.linkColor(edge.type))
      .attr("d", (edge) => this.linkPath(edge));

    minimap
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("cx", (node) => node.x)
      .attr("cy", (node) => node.y)
      .attr("r", (node) => (node.isFocus ? 3.2 : 2.2))
      .attr("fill", (node) => this.nodeFill(node))
      .attr("stroke", this.themeColor("--theme-graph-outline", "15 23 42"))
      .attr("stroke-width", 0.75);

    this.minimapViewportSelection = minimap
      .append("rect")
      .attr("fill", `rgb(${this.themeTriplet("--theme-graph-selection-fill", "96 165 250")} / 0.14)`)
      .attr("stroke", this.themeColor("--theme-graph-selection", "125 211 252"))
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8)
      .style("cursor", "grab");

    const dragBehavior = d3
      .drag<SVGRectElement, unknown>()
      .on("start", () => {
        this.minimapViewportSelection?.style("cursor", "grabbing");
      })
      .on("drag", (event) => {
        if (!this.minimapSelection) {
          return;
        }
        const [pointerX, pointerY] = d3.pointer(event, this.minimapSelection.node());
        this.centerViewportOn(pointerX, pointerY);
      })
      .on("end", () => {
        this.minimapViewportSelection?.style("cursor", "grab");
      });

    this.minimapViewportSelection.call(dragBehavior);
    minimap.on("click", (event) => {
      if (event.defaultPrevented) {
        return;
      }
      const [pointerX, pointerY] = d3.pointer(event, minimap.node());
      this.centerViewportOn(pointerX, pointerY);
    });
    this.updateMinimap();
  }

  private clearMinimap(): void {
    if (!this.minimapSelection) {
      return;
    }
    this.minimapSelection.selectAll("*").remove();
    this.minimapViewportSelection = undefined;
    this.updateZoomIndicator();
  }

  private applyTransform(): void {
    if (!this.canvasSelection) {
      return;
    }

    this.canvasSelection.attr("transform", this.currentTransform.toString());
    this.updateMinimap();
    this.updateZoomIndicator();
  }

  private updateSelectionStyles(): void {
    if (!this.nodeSelection) {
      return;
    }

    this.nodeSelection
      .select<SVGCircleElement>("circle")
      .attr("r", (node) => (node.isFocus ? 8.5 : this.selectedNodeId === node.id ? 7.2 : this.nodeRadius(node)))
      .attr("fill", (node) => this.nodeFill(node))
      .attr("stroke", (node) => this.selectedNodeId === node.id
        ? this.themeColor("--theme-graph-selection", "125 211 252")
        : this.themeColor("--theme-graph-outline", "15 23 42"))
      .attr("stroke-width", (node) => (this.selectedNodeId === node.id ? 2.4 : 1.2))
      .attr("opacity", (node) => (this.selectedNodeId && node.id !== this.selectedNodeId ? 0.9 : 1));

    this.labelSelection?.attr("opacity", (node) => (this.selectedNodeId && node.id !== this.selectedNodeId ? 0.84 : 1));
  }

  private updateMinimap(): void {
    if (!this.minimapViewportSelection) {
      return;
    }

    const viewport = this.getViewportRect();
    if (!viewport) {
      this.minimapViewportSelection.attr("display", "none");
      return;
    }

    this.minimapViewportSelection
      .attr("display", null)
      .attr("x", viewport.x)
      .attr("y", viewport.y)
      .attr("width", viewport.width)
      .attr("height", viewport.height);
  }

  private getViewportRect(): ViewportRect | undefined {
    const svgElement = this.svgSelection?.node();
    const bounds = this.graphBounds;
    if (!svgElement || !bounds) {
      return undefined;
    }

    const viewportSize = this.getSvgViewportSize();
    const viewportWidth = viewportSize.width / this.currentTransform.k;
    const viewportHeight = viewportSize.height / this.currentTransform.k;
    const maxX = Math.max(bounds.minX, bounds.maxX - viewportWidth);
    const maxY = Math.max(bounds.minY, bounds.maxY - viewportHeight);

    return {
      x: clamp((-viewportSize.width / 2 - this.currentTransform.x) / this.currentTransform.k, bounds.minX, maxX),
      y: clamp((-viewportSize.height / 2 - this.currentTransform.y) / this.currentTransform.k, bounds.minY, maxY),
      width: Math.min(viewportWidth, bounds.maxX - bounds.minX),
      height: Math.min(viewportHeight, bounds.maxY - bounds.minY)
    };
  }

  private centerViewportOn(contentX: number, contentY: number): void {
    const svgElement = this.svgSelection?.node();
    const bounds = this.graphBounds;
    if (!svgElement || !bounds || !this.svgSelection) {
      return;
    }

    const scale = this.currentTransform.k;
    const viewportSize = this.getSvgViewportSize();
    const viewportWidth = viewportSize.width / scale;
    const viewportHeight = viewportSize.height / scale;
    const halfWidth = viewportWidth / 2;
    const halfHeight = viewportHeight / 2;

    const centerX = clamp(contentX, bounds.minX + halfWidth, bounds.maxX - halfWidth);
    const centerY = clamp(contentY, bounds.minY + halfHeight, bounds.maxY - halfHeight);
    const nextTransform = d3.zoomIdentity.translate(-centerX * scale, -centerY * scale).scale(scale);
    this.svgSelection.call(this.zoomBehavior.transform, nextTransform);
  }

  private updateZoomIndicator(): void {
    const zoomText = `${Math.round(this.currentTransform.k * 100)}%`;
    const label = this.querySelector<HTMLElement>("[data-zoom-label]");
    const minimapLabel = this.querySelector<HTMLElement>("[data-minimap-zoom]");
    if (label) {
      label.textContent = zoomText;
    }
    if (minimapLabel) {
      minimapLabel.textContent = zoomText;
    }
  }

  private zoomIn = () => {
    if (!this.svgSelection) {
      return;
    }
    this.svgSelection.call(this.zoomBehavior.scaleBy, 1.25);
  };

  private zoomOut = () => {
    if (!this.svgSelection) {
      return;
    }
    this.svgSelection.call(this.zoomBehavior.scaleBy, 0.8);
  };

  private resetZoom = () => {
    if (!this.svgSelection) {
      return;
    }
    this.svgSelection.call(this.zoomBehavior.transform, this.initialTransform);
  };

  private defaultTransform(): d3.ZoomTransform {
    const svgElement = this.svgSelection?.node();
    const bounds = this.graphBounds;
    if (!svgElement || !bounds) {
      return d3.zoomIdentity;
    }

    const viewportSize = this.getSvgViewportSize();
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        Math.min((viewportSize.width - 48) / contentWidth, (viewportSize.height - 48) / contentHeight)
      )
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    return d3.zoomIdentity.translate(-centerX * scale, -centerY * scale).scale(scale);
  }

  private getSvgViewportSize(): { width: number; height: number } {
    const svgElement = this.svgSelection?.node();
    if (!svgElement) {
      return { width: 0, height: 0 };
    }

    const viewBox = svgElement.viewBox.baseVal;
    if (viewBox.width > 0 && viewBox.height > 0) {
      return {
        width: viewBox.width,
        height: viewBox.height
      };
    }

    const rect = svgElement.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height
    };
  }

  private initialNodeX(node: ProjectionGraphNode, index: number): number {
    const depthOffset = node.depth * 180 - 180;
    const ring = 60 + (index % 7) * 18;
    return depthOffset + Math.cos((index / Math.max(this.graph?.nodes.length ?? 1, 1)) * Math.PI * 2) * ring;
  }

  private initialNodeY(node: ProjectionGraphNode, index: number): number {
    const ring = 80 + (index % 9) * 16;
    const laneOffset = this.nodeTargetY(node);
    return laneOffset + Math.sin((index / Math.max(this.graph?.nodes.length ?? 1, 1)) * Math.PI * 2) * ring;
  }

  private nodeTargetX(node: ProjectionGraphNode): number {
    if (node.isFocus) {
      return -300;
    }
    if (node.nodeType === "entry") {
      return -180;
    }
    return Math.min(node.depth, 8) * 180 - 120;
  }

  private nodeTargetY(node: ProjectionGraphNode): number {
    if (node.isFocus) {
      return 0;
    }
    if (node.nodeType === "jsp") {
      return -90;
    }
    if (node.nodeType === "unresolved") {
      return 120;
    }
    if (node.nodeType === "entry") {
      return -160;
    }
    return 0;
  }

  private nodeCharge(node: ProjectionGraphNode): number {
    if (node.isFocus) {
      return -520;
    }
    if (node.nodeType === "unresolved") {
      return -340;
    }
    return -220;
  }

  private linkDistance(edge: SimLink): number {
    if (edge.type.includes("ENTRY_SEED")) {
      return 120;
    }
    if (edge.type.includes("JAVA_CALL")) {
      return 126;
    }
    if (edge.type.includes("JSP_SCRIPTLET_CALL") || edge.type.includes("JSP_USES_TAG")) {
      return 118;
    }
    return 110;
  }

  private linkStrength(edge: SimLink): number {
    if (edge.type.includes("ENTRY_SEED")) {
      return 0.95;
    }
    if (edge.type.includes("JAVA_CALL")) {
      return 0.45;
    }
    return 0.36;
  }

  private nodeRadius(node: ProjectionGraphNode): number {
    if (node.isFocus) {
      return 8.5;
    }
    if (node.nodeType === "entry") {
      return 7;
    }
    if (node.nodeType === "unresolved") {
      return 6.4;
    }
    return 5.2;
  }

  private nodeLabelLines(node: ProjectionGraphNode): string[] {
    const lines = [node.label];
    if (node.isFocus) {
      lines.push("focus");
      return lines;
    }
    if (this.selectedNodeId === node.id || node.depth <= 2) {
      lines.push(node.edgeType ?? node.nodeType);
    }
    return lines;
  }

  private measureGraphBounds(nodes: PositionedNode[]): GraphBounds {
    const minX = d3.min(nodes, (node) => node.x - this.nodeRadius(node) - 24) ?? -160;
    const maxX = d3.max(nodes, (node) => node.x + this.nodeRadius(node) + LABEL_WIDTH) ?? 160;
    const minY = d3.min(nodes, (node) => node.y - this.nodeRadius(node) - 42) ?? -120;
    const maxY = d3.max(nodes, (node) => node.y + this.nodeRadius(node) + 48) ?? 120;
    return {
      minX: minX - MINIMAP_PADDING,
      maxX: maxX + MINIMAP_PADDING,
      minY: minY - MINIMAP_PADDING,
      maxY: maxY + MINIMAP_PADDING
    };
  }

  private resolveRenderLinks(nodes: PositionedNode[], edges: ProjectionGraphEdge[]): RenderLink[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return edges
      .map((edge): RenderLink | undefined => {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) {
          return undefined;
        }
        return {
          ...edge,
          source,
          target
        };
      })
      .filter((edge): edge is RenderLink => edge !== undefined);
  }

  private linkPath(link: Pick<RenderLink, "source" | "target">): string {
    const sourceX = link.source.x;
    const sourceY = link.source.y;
    const targetX = link.target.x;
    const targetY = link.target.y;
    const curve = Math.max(48, Math.abs(targetX - sourceX) * 0.42);
    const controlX = sourceX + curve;
    const targetControlX = targetX - curve * 0.68;
    return `M${sourceX},${sourceY}C${controlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  }

  private linkColor(edgeType: string): string {
    if (edgeType.includes("ENTRY_SEED")) return this.themeColor("--theme-graph-entry", "245 163 91");
    if (edgeType.includes("JAVA_CALL")) return "rgb(251 191 36)";
    if (edgeType.includes("JAVA_IMPORT")) return this.themeColor("--theme-graph-arrow", "91 119 184");
    if (edgeType.includes("JAVA_NEW")) return "rgb(45 212 191)";
    if (edgeType.includes("JAVA_TYPE_REFERENCE")) return "rgb(148 163 184)";
    if (edgeType.includes("JSP_USES_TAG")) return this.themeColor("--theme-graph-java", "126 224 160");
    if (edgeType.includes("JSP_SCRIPTLET_CALL")) return this.themeColor("--theme-graph-jsp", "138 214 255");
    return this.themeColor("--theme-graph-arrow", "91 119 184");
  }

  private nodeFill(node: ProjectionGraphNode): string {
    if (node.isFocus) return this.themeColor("--theme-graph-focus", "245 196 107");
    if (node.nodeType === "entry") return this.themeColor("--theme-graph-entry", "245 163 91");
    if (node.nodeType === "jsp") return this.themeColor("--theme-graph-jsp", "138 214 255");
    if (node.nodeType === "java") return this.themeColor("--theme-graph-java", "126 224 160");
    return this.themeColor("--theme-graph-unresolved", "255 139 139");
  }

  private themeTriplet(variableName: string, fallback: string): string {
    return getComputedStyle(this).getPropertyValue(variableName).trim() || fallback;
  }

  private themeColor(variableName: string, fallback: string): string {
    return `rgb(${this.themeTriplet(variableName, fallback)})`;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (max < min) {
    return (min + max) / 2;
  }
  return Math.min(Math.max(value, min), max);
}

customElements.define("projection-dependency-graph", ProjectionDependencyGraph);

declare global {
  interface HTMLElementTagNameMap {
    "projection-dependency-graph": ProjectionDependencyGraph;
  }
}
