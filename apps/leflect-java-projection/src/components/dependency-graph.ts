import { LitElement, PropertyValues, html } from "lit";
import * as d3 from "d3";

import type { ProjectionGraphNode, ProjectionGraphResponse } from "../types";

type TreeNodeSelection = d3.Selection<SVGGElement, d3.HierarchyPointNode<ProjectionGraphNode>, SVGGElement, unknown>;

const MARGINS = { top: 28, right: 180, bottom: 28, left: 120 };
const NODE_DX = 22;
const NODE_DY = 220;

class ProjectionDependencyGraph extends LitElement {
  static properties = {
    graph: { attribute: false },
    selectedNodeId: { attribute: false }
  };

  graph?: ProjectionGraphResponse;
  selectedNodeId?: string;

  private svgSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private canvasSelection?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nodeSelection?: TreeNodeSelection;
  private zoomBehavior = d3.zoom<SVGSVGElement, unknown>();
  private currentTransform = d3.zoomIdentity;
  private treeOffsetY = 0;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    return html`
      <div class="relative h-full w-full overflow-hidden rounded border border-chrome-800 bg-[#060b18] shadow-insetline">
        <svg class="h-full w-full"></svg>
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
    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.45, 2.4]).on("zoom", (event) => {
      this.currentTransform = event.transform;
      this.applyTransform();
    });
    this.svgSelection.call(this.zoomBehavior);
    this.drawGraph();
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("graph")) {
      this.drawGraph();
      return;
    }
    if (changedProperties.has("selectedNodeId")) {
      this.updateSelectionStyles();
    }
  }

  private drawGraph(): void {
    if (!this.svgSelection || !this.canvasSelection) {
      return;
    }

    this.svgSelection.selectAll("defs").remove();
    this.canvasSelection.selectAll("*").remove();
    this.nodeSelection = undefined;
    this.currentTransform = d3.zoomIdentity;
    this.treeOffsetY = 0;

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

    let x0 = Infinity;
    let x1 = -x0;
    root.each((node) => {
      if (node.x < x0) x0 = node.x;
      if (node.x > x1) x1 = node.x;
    });

    this.treeOffsetY = MARGINS.top - x0;
    const height = x1 - x0 + MARGINS.top + MARGINS.bottom;
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
      .attr("stroke", (datum) => {
        const edgeType = datum.target.data.edgeType ?? "";
        if (edgeType.includes("JSP_USES_TAG")) return "#7ee0a0";
        if (edgeType.includes("JSP_SCRIPTLET_CALL")) return "#8ad6ff";
        return "#5b77b8";
      })
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

    this.applyTransform();
    this.updateSelectionStyles();
  }

  private applyTransform(): void {
    if (!this.canvasSelection) {
      return;
    }

    this.canvasSelection.attr(
      "transform",
      `translate(${this.currentTransform.x + MARGINS.left},${this.currentTransform.y + this.treeOffsetY}) scale(${this.currentTransform.k})`
    );
  }

  private updateSelectionStyles(): void {
    if (!this.nodeSelection) {
      return;
    }

    this.nodeSelection
      .select<SVGCircleElement>("circle")
      .attr("r", (datum) => (datum.data.isFocus ? 6.5 : this.selectedNodeId === datum.data.id ? 5.4 : 4.2))
      .attr("fill", (datum) => {
        if (datum.data.isFocus) return "#f5c46b";
        if (datum.data.nodeType === "jsp") return "#8ad6ff";
        if (datum.data.nodeType === "java") return "#7ee0a0";
        return "#ff8b8b";
      })
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
}

customElements.define("projection-dependency-graph", ProjectionDependencyGraph);

declare global {
  interface HTMLElementTagNameMap {
    "projection-dependency-graph": ProjectionDependencyGraph;
  }
}
