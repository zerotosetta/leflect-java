import { LitElement, html } from "lit";
import * as d3 from "d3";

import type { ProjectionGraphNode, ProjectionGraphResponse } from "../types";

class ProjectionDependencyGraph extends LitElement {
  static properties = {
    graph: { state: true },
    selectedNodeId: { attribute: false }
  };

  graph?: ProjectionGraphResponse;
  selectedNodeId?: string;

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

  override updated(): void {
    this.draw();
  }

  private draw(): void {
    const svgElement = this.querySelector("svg");
    if (!svgElement) {
      return;
    }

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    if (!this.graph || this.graph.nodes.length === 0) {
      return;
    }

    const nodes = this.graph.nodes.map((node) => ({ ...node }));
    const width = Math.max(720, svgElement.getBoundingClientRect().width || 960);
    const dx = 22;
    const dy = 220;
    const margins = { top: 28, right: 180, bottom: 28, left: 120 };

    const stratified = d3
      .stratify<ProjectionGraphNode>()
      .id((datum) => datum.id)
      .parentId((datum) => datum.parentId ?? null)(nodes);

    const tree = d3.tree<typeof stratified.data>().nodeSize([dx, dy]);
    const root = tree(stratified);

    let x0 = Infinity;
    let x1 = -x0;
    root.each((node) => {
      if (node.x < x0) x0 = node.x;
      if (node.x > x1) x1 = node.x;
    });

    const height = x1 - x0 + margins.top + margins.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const defs = svg.append("defs");
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

    const canvas = svg.append("g").attr("transform", `translate(${margins.left},${margins.top - x0})`);

    svg.call(
      d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.45, 2.4]).on("zoom", (event) => {
        canvas.attr("transform", `translate(${event.transform.x + margins.left},${event.transform.y + margins.top - x0}) scale(${event.transform.k})`);
      })
    );

    canvas
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

    const node = canvas
      .append("g")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
      .attr("transform", (datum) => `translate(${datum.y},${datum.x})`)
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

    node
      .append("circle")
      .attr("r", (datum) => (datum.data.isFocus ? 6.5 : this.selectedNodeId === datum.data.id ? 5.4 : 4.2))
      .attr("fill", (datum) => {
        if (datum.data.isFocus) return "#f5c46b";
        if (datum.data.nodeType === "jsp") return "#8ad6ff";
        if (datum.data.nodeType === "java") return "#7ee0a0";
        return "#ff8b8b";
      })
      .attr("stroke", (datum) => (this.selectedNodeId === datum.data.id ? "#f8fafc" : "#0f172a"))
      .attr("stroke-width", (datum) => (this.selectedNodeId === datum.data.id ? 1.8 : 1.1));

    node
      .append("text")
      .attr("dy", "0.32em")
      .attr("x", (datum) => (datum.children ? -10 : 10))
      .attr("text-anchor", (datum) => (datum.children ? "end" : "start"))
      .attr("fill", (datum) => (datum.data.isFocus ? "#f8fafc" : "#dbeafe"))
      .attr("font-size", 10)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace")
      .text((datum) => datum.data.label)
      .clone(true)
      .lower()
      .attr("stroke", "#050816")
      .attr("stroke-width", 3);

    node
      .append("text")
      .attr("dy", "1.35em")
      .attr("x", (datum) => (datum.children ? -10 : 10))
      .attr("text-anchor", (datum) => (datum.children ? "end" : "start"))
      .attr("fill", "#64748b")
      .attr("font-size", 8)
      .text((datum) => datum.data.edgeType ?? (datum.data.isFocus ? "focus" : datum.data.nodeType));
  }
}

customElements.define("projection-dependency-graph", ProjectionDependencyGraph);

declare global {
  interface HTMLElementTagNameMap {
    "projection-dependency-graph": ProjectionDependencyGraph;
  }
}
