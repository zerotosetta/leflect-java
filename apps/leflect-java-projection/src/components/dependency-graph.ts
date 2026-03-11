import { LitElement, html } from "lit";
import * as d3 from "d3";

import type { ProjectionGraphResponse } from "../types";

class ProjectionDependencyGraph extends LitElement {
  static properties = {
    graph: { state: true },
    selectedNodeId: { attribute: false }
  };

  graph?: ProjectionGraphResponse;
  selectedNodeId?: string;
  private simulation?: d3.Simulation<d3.SimulationNodeDatum, undefined>;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    return html`
      <div class="relative h-full w-full overflow-hidden rounded border border-chrome-800 bg-[#060b18] shadow-insetline">
        <svg class="h-full w-full"></svg>
        ${this.graph && this.graph.nodes.length > 0
          ? null
          : html`<div class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">선택한 파일의 그래프가 없습니다.</div>`}
      </div>
    `;
  }

  override updated(): void {
    this.draw();
  }

  override disconnectedCallback(): void {
    this.simulation?.stop();
    this.simulation = undefined;
    super.disconnectedCallback();
  }

  private draw(): void {
    const svgElement = this.querySelector("svg");
    if (!svgElement) {
      return;
    }

    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(320, rect.width || 960);
    const height = Math.max(240, rect.height || 640);
    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    this.simulation?.stop();
    this.simulation = undefined;

    if (!this.graph || this.graph.nodes.length === 0) {
      return;
    }

    const nodes = this.graph.nodes.map((node) => ({ ...node }));
    const links = this.graph.edges.map((edge) => ({ ...edge }));

    const root = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.35, 2.5]).on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
      })
    );

    const link = root
      .append("g")
      .attr("stroke-linecap", "round")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (edge) => edge.type === "JSP_USES_TAG" ? "#7ee0a0" : edge.type === "JSP_SCRIPTLET_CALL" ? "#8ad6ff" : "#5b77b8")
      .attr("stroke-opacity", 0.68)
      .attr("stroke-width", (edge) => edge.source === this.graph?.focusPath || edge.target === this.graph?.focusPath ? 1.8 : 1.05);

    const node = root
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (_, datum) => {
        this.dispatchEvent(new CustomEvent("projection-node-select", {
          detail: { nodeId: datum.id },
          bubbles: true,
          composed: true
        }));
      });

    node
      .append("circle")
      .attr("r", (datum) => datum.isFocus ? 11 : this.selectedNodeId === datum.id ? 9 : 7)
      .attr("fill", (datum) => {
        if (datum.isFocus) return "#f5c46b";
        if (datum.nodeType === "jsp") return "#8ad6ff";
        if (datum.nodeType === "java") return "#7ee0a0";
        return "#ff8b8b";
      })
      .attr("stroke", (datum) => this.selectedNodeId === datum.id ? "#f8fafc" : "#0f172a")
      .attr("stroke-width", (datum) => this.selectedNodeId === datum.id ? 2.2 : 1.2);

    node
      .append("text")
      .text((datum) => datum.label)
      .attr("x", 11)
      .attr("y", 3)
      .attr("fill", "#dbeafe")
      .attr("font-size", 10)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace")
      .attr("opacity", (datum) => datum.isFocus || this.selectedNodeId === datum.id || nodes.length <= 18 ? 1 : 0.45);

    this.simulation = d3
      .forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force(
        "link",
        d3.forceLink(links as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[])
          .id((datum: any) => datum.id)
          .distance((edge: any) => edge.source.id === this.graph?.focusPath || edge.target.id === this.graph?.focusPath ? 95 : 140)
          .strength(0.42)
      )
      .force("charge", d3.forceManyBody().strength(-360))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((datum: any) => datum.isFocus ? 36 : 24));

    const focusNode = nodes.find((nodeItem) => nodeItem.id === this.graph?.focusPath) as (d3.SimulationNodeDatum & { fx?: number; fy?: number }) | undefined;
    if (focusNode) {
      focusNode.fx = width / 2;
      focusNode.fy = height / 2;
    }

    this.simulation.on("tick", () => {
      link
        .attr("x1", (datum: any) => datum.source.x ?? width / 2)
        .attr("y1", (datum: any) => datum.source.y ?? height / 2)
        .attr("x2", (datum: any) => datum.target.x ?? width / 2)
        .attr("y2", (datum: any) => datum.target.y ?? height / 2);

      node.attr("transform", (datum: any) => `translate(${datum.x ?? width / 2}, ${datum.y ?? height / 2})`);
    });
  }
}

customElements.define("projection-dependency-graph", ProjectionDependencyGraph);

declare global {
  interface HTMLElementTagNameMap {
    "projection-dependency-graph": ProjectionDependencyGraph;
  }
}
