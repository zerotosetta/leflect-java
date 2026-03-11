import { LitElement, PropertyValues, html } from "lit";
import * as d3 from "d3";

import type { ProjectionGraphNode, ProjectionGraphResponse } from "../types";

type TreeNodeSelection = d3.Selection<SVGGElement, d3.HierarchyPointNode<ProjectionGraphNode>, SVGGElement, unknown>;

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

const MARGINS = { top: 28, right: 180, bottom: 28, left: 120 };
const NODE_DX = 22;
const NODE_DY = 220;
const MINIMAP_PADDING = 28;
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.18;
const MAX_SCALE = 2.4;

class ProjectionDependencyGraph extends LitElement {
  static properties = {
    graph: { attribute: false },
    selectedNodeId: { attribute: false }
  };

  graph?: ProjectionGraphResponse;
  selectedNodeId?: string;

  private svgSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private canvasSelection?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private minimapSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private minimapViewportSelection?: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private nodeSelection?: TreeNodeSelection;
  private zoomBehavior = d3.zoom<SVGSVGElement, unknown>();
  private currentTransform = d3.zoomIdentity;
  private initialTransform = d3.zoomIdentity;
  private treeOffsetY = 0;
  private graphBounds?: GraphBounds;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    return html`
      <div class="relative h-full w-full overflow-hidden rounded border border-chrome-800 bg-[#060b18] shadow-insetline">
        <svg class="h-full w-full"></svg>
        ${this.graph && this.graph.nodes.length > 0
          ? html`
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
                <svg class="block h-32 w-full rounded border border-chrome-800 bg-[#09101f]" data-minimap></svg>
              </div>
            `
          : null}
        ${this.graph && this.graph.nodes.length > 0
          ? null
          : html`<div class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">선택한 파일의 outbound dependency tree가 없습니다.</div>`}
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
    if (changedProperties.has("graph")) {
      this.refreshOverlayRefs();
      this.drawGraph();
      return;
    }
    if (changedProperties.has("selectedNodeId")) {
      this.updateSelectionStyles();
    }
  }

  private refreshOverlayRefs(): void {
    const minimapElement = this.querySelector<SVGSVGElement>("[data-minimap]");
    this.minimapSelection = minimapElement ? d3.select(minimapElement) : undefined;
  }

  private drawGraph(): void {
    if (!this.svgSelection || !this.canvasSelection) {
      return;
    }

    this.svgSelection.selectAll("defs").remove();
    this.canvasSelection.selectAll("*").remove();
    this.clearMinimap();
    this.nodeSelection = undefined;
    this.currentTransform = d3.zoomIdentity;
    this.initialTransform = d3.zoomIdentity;
    this.treeOffsetY = 0;
    this.graphBounds = undefined;

    if (!this.graph || this.graph.nodes.length === 0) {
      this.applyTransform();
      return;
    }

    const svgElement = this.svgSelection.node();
    if (!svgElement) {
      return;
    }

    const width = Math.max(720, svgElement.getBoundingClientRect().width || 960);
    const nodes = this.graph.nodes.map((node) => ({ ...node }));
    const root = d3.tree<ProjectionGraphNode>().nodeSize([NODE_DX, NODE_DY])(
      d3
        .stratify<ProjectionGraphNode>()
        .id((datum) => datum.id)
        .parentId((datum) => datum.parentId ?? null)(nodes)
    );

    let minTreeY = Infinity;
    let maxTreeY = -Infinity;
    let maxTreeX = 0;
    root.each((node) => {
      if (node.x < minTreeY) minTreeY = node.x;
      if (node.x > maxTreeY) maxTreeY = node.x;
      if (node.y > maxTreeX) maxTreeX = node.y;
    });

    this.treeOffsetY = MARGINS.top - minTreeY;
    this.graphBounds = {
      minX: -MINIMAP_PADDING,
      maxX: maxTreeX + MINIMAP_PADDING,
      minY: minTreeY - MINIMAP_PADDING,
      maxY: maxTreeY + MINIMAP_PADDING
    };

    const height = maxTreeY - minTreeY + MARGINS.top + MARGINS.bottom;
    this.svgSelection.attr("viewBox", `0 0 ${width} ${height}`);

    const defs = this.svgSelection.append("defs");
    defs
      .append("marker")
      .attr("id", "projection-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#5b77b8");

    this.canvasSelection
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 1.25)
      .selectAll("path")
      .data(root.links())
      .join("path")
      .attr("stroke", (datum) => this.linkColor(datum.target.data.edgeType ?? ""))
      .attr("marker-end", "url(#projection-arrow)")
      .attr(
        "d",
        d3
          .linkHorizontal<d3.HierarchyPointLink<ProjectionGraphNode>, d3.HierarchyPointNode<ProjectionGraphNode>>()
          .x((datum) => datum.y)
          .y((datum) => datum.x)
      );

    this.nodeSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGGElement, d3.HierarchyPointNode<ProjectionGraphNode>>("g")
      .data(root.descendants())
      .join("g")
      .attr("transform", (datum) => `translate(${datum.y},${datum.x})`)
      .attr("data-node-id", (datum) => datum.data.id)
      .style("cursor", "pointer")
      .on("click", (_, datum) => {
        this.dispatchEvent(
          new CustomEvent("projection-node-select", {
            detail: { nodeId: datum.data.id },
            bubbles: true,
            composed: true
          })
        );
      });

    this.nodeSelection.append("circle");

    this.nodeSelection
      .append("text")
      .attr("class", "label")
      .attr("dy", "0.32em")
      .attr("x", (datum) => (datum.children ? -10 : 10))
      .attr("text-anchor", (datum) => (datum.children ? "end" : "start"))
      .attr("font-size", 10)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace")
      .text((datum) => datum.data.label)
      .clone(true)
      .lower()
      .attr("class", "label-outline")
      .attr("stroke", "#050816")
      .attr("stroke-width", 3);

    this.nodeSelection
      .append("text")
      .attr("class", "subtitle")
      .attr("dy", "1.35em")
      .attr("x", (datum) => (datum.children ? -10 : 10))
      .attr("text-anchor", (datum) => (datum.children ? "end" : "start"))
      .attr("font-size", 8)
      .text((datum) => datum.data.edgeType ?? (datum.data.isFocus ? "focus" : datum.data.nodeType));

    this.drawMinimap(root);
    this.initialTransform = this.defaultTransform();
    this.currentTransform = this.initialTransform;
    this.svgSelection.call(this.zoomBehavior.transform, this.initialTransform);
    this.updateSelectionStyles();
  }

  private drawMinimap(root: d3.HierarchyPointNode<ProjectionGraphNode>): void {
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
      .attr("stroke-opacity", 0.75)
      .selectAll("path")
      .data(root.links())
      .join("path")
      .attr("stroke", (datum) => this.linkColor(datum.target.data.edgeType ?? ""))
      .attr(
        "d",
        d3
          .linkHorizontal<d3.HierarchyPointLink<ProjectionGraphNode>, d3.HierarchyPointNode<ProjectionGraphNode>>()
          .x((datum) => datum.y)
          .y((datum) => datum.x)
      );

    minimap
      .append("g")
      .selectAll("circle")
      .data(root.descendants())
      .join("circle")
      .attr("cx", (datum) => datum.y)
      .attr("cy", (datum) => datum.x)
      .attr("r", (datum) => (datum.data.isFocus ? 3.2 : 2.2))
      .attr("fill", (datum) => this.nodeFill(datum.data))
      .attr("stroke", "#050816")
      .attr("stroke-width", 0.75);

    this.minimapViewportSelection = minimap
      .append("rect")
      .attr("fill", "rgba(96, 165, 250, 0.14)")
      .attr("stroke", "#7dd3fc")
      .attr("stroke-width", 2)
      .attr("rx", 8)
      .attr("ry", 8)
      .style("cursor", "grab");

    const dragBehavior = d3.drag<SVGRectElement, unknown>().on("start", () => {
      this.minimapViewportSelection?.style("cursor", "grabbing");
    }).on("drag", (event) => {
      if (!this.minimapSelection) {
        return;
      }
      const [pointerX, pointerY] = d3.pointer(event, this.minimapSelection.node());
      this.centerViewportOn(pointerX, pointerY);
    }).on("end", () => {
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

    this.canvasSelection.attr(
      "transform",
      `translate(${this.currentTransform.x + MARGINS.left},${this.currentTransform.y + this.treeOffsetY}) scale(${this.currentTransform.k})`
    );
    this.updateMinimapViewport();
    this.updateZoomIndicator();
  }

  private updateSelectionStyles(): void {
    if (!this.nodeSelection) {
      return;
    }

    this.nodeSelection
      .select<SVGCircleElement>("circle")
      .attr("r", (datum) => (datum.data.isFocus ? 6.5 : this.selectedNodeId === datum.data.id ? 5.4 : 4.2))
      .attr("fill", (datum) => this.nodeFill(datum.data))
      .attr("stroke", (datum) => (this.selectedNodeId === datum.data.id ? "#f8fafc" : "#0f172a"))
      .attr("stroke-width", (datum) => (this.selectedNodeId === datum.data.id ? 1.8 : 1.1));

    this.nodeSelection
      .select<SVGTextElement>("text.label")
      .attr("fill", (datum) => (datum.data.isFocus ? "#f8fafc" : this.selectedNodeId === datum.data.id ? "#ffffff" : "#dbeafe"))
      .attr("font-weight", (datum) => (this.selectedNodeId === datum.data.id ? 700 : 500));

    this.nodeSelection
      .select<SVGTextElement>("text.subtitle")
      .attr("fill", (datum) => (this.selectedNodeId === datum.data.id ? "#cbd5e1" : "#64748b"));
  }

  private updateMinimapViewport(): void {
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

    const viewportWidth = svgElement.getBoundingClientRect().width / this.currentTransform.k;
    const viewportHeight = svgElement.getBoundingClientRect().height / this.currentTransform.k;
    const maxX = Math.max(bounds.minX, bounds.maxX - viewportWidth);
    const maxY = Math.max(bounds.minY, bounds.maxY - viewportHeight);

    return {
      x: clamp((-(this.currentTransform.x + MARGINS.left)) / this.currentTransform.k, bounds.minX, maxX),
      y: clamp((-(this.currentTransform.y + this.treeOffsetY)) / this.currentTransform.k, bounds.minY, maxY),
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
    const viewportWidth = svgElement.getBoundingClientRect().width / scale;
    const viewportHeight = svgElement.getBoundingClientRect().height / scale;
    const halfWidth = viewportWidth / 2;
    const halfHeight = viewportHeight / 2;

    const centerX = clamp(contentX, bounds.minX + halfWidth, bounds.maxX - halfWidth);
    const centerY = clamp(contentY, bounds.minY + halfHeight, bounds.maxY - halfHeight);

    const nextTransform = d3.zoomIdentity
      .translate(-centerX * scale + svgElement.getBoundingClientRect().width / 2 - MARGINS.left, -centerY * scale + svgElement.getBoundingClientRect().height / 2 - this.treeOffsetY)
      .scale(scale);

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

    const viewportWidth = svgElement.getBoundingClientRect().width;
    const viewportHeight = svgElement.getBoundingClientRect().height;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    return d3.zoomIdentity
      .translate(viewportWidth / 2 - centerX * DEFAULT_SCALE - MARGINS.left, viewportHeight / 2 - centerY * DEFAULT_SCALE - this.treeOffsetY)
      .scale(DEFAULT_SCALE);
  }

  private linkColor(edgeType: string): string {
    if (edgeType.includes("JSP_USES_TAG")) return "#7ee0a0";
    if (edgeType.includes("JSP_SCRIPTLET_CALL")) return "#8ad6ff";
    return "#5b77b8";
  }

  private nodeFill(node: ProjectionGraphNode): string {
    if (node.isFocus) return "#f5c46b";
    if (node.nodeType === "jsp") return "#8ad6ff";
    if (node.nodeType === "java") return "#7ee0a0";
    return "#ff8b8b";
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
