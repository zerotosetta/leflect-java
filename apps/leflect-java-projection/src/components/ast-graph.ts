import { LitElement, PropertyValues, html } from "lit";
import * as d3 from "d3";

import type {
  ProjectionAstGraphLink,
  ProjectionAstGraphNode,
  ProjectionAstGraphResponse,
  ProjectionAstLayout,
  ProjectionTheme
} from "../types";

type PositionedNode = ProjectionAstGraphNode & {
  x: number;
  y: number;
};

type SimNode = PositionedNode & d3.SimulationNodeDatum;
type SimLink = Omit<ProjectionAstGraphLink, "source" | "target"> & d3.SimulationLinkDatum<SimNode>;
type RenderLink = Omit<ProjectionAstGraphLink, "source" | "target"> & {
  source: PositionedNode;
  target: PositionedNode;
};
type TreeHierarchyDatum = {
  id: string;
  node?: ProjectionAstGraphNode;
  children: TreeHierarchyDatum[];
};

const MIN_SCALE = 0.22;
const MAX_SCALE = 2.4;
const TREE_HORIZONTAL_GAP = 176;
const TREE_VERTICAL_GAP = 28;
const TREE_LABEL_WIDTH = 240;

class ProjectionAstGraph extends LitElement {
  static properties = {
    graph: { attribute: false },
    layout: { attribute: false },
    selectedNodeId: { attribute: false },
    theme: { attribute: false }
  };

  graph?: ProjectionAstGraphResponse;
  layout: ProjectionAstLayout = "force";
  selectedNodeId?: string;
  theme: ProjectionTheme = "dark";

  private svgSelection?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private canvasSelection?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation?: d3.Simulation<SimNode, undefined>;
  private nodeSelection?: d3.Selection<SVGGElement, PositionedNode, SVGGElement, unknown>;
  private labelSelection?: d3.Selection<SVGTextElement, PositionedNode, SVGGElement, unknown>;
  private zoomBehavior = d3.zoom<SVGSVGElement, unknown>();

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    const graph = this.graph;
    const layoutLabel = this.layout === "tree" ? "AST Tree Graph" : "AST Force Graph";

    return html`
      <div class="relative h-full w-full overflow-hidden rounded border border-chrome-800 bg-[rgb(var(--theme-graph-surface))] shadow-insetline">
        <svg class="h-full w-full"></svg>
        ${graph && graph.nodes.length > 0
          ? html`
              <div class="absolute right-2 top-2 z-10 rounded border border-chrome-700 bg-chrome-950/90 px-2 py-1 text-[9px] text-slate-400 backdrop-blur-sm">
                <div class="mb-1 uppercase tracking-[0.18em] text-slate-500">${layoutLabel}</div>
                <div class="grid gap-1 text-[9px]">
                  <div>nodes ${graph.stats.nodes}</div>
                  <div>edges ${graph.stats.edges}</div>
                  <div>${graph.includeExternal ? "external on" : "external off"}</div>
                </div>
              </div>
            `
          : null}
        ${graph && graph.nodes.length > 0
          ? null
          : html`<div class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">No AST graph is available for the selected file.</div>`}
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
      this.canvasSelection?.attr("transform", event.transform.toString());
    });
    this.svgSelection.call(this.zoomBehavior);
    this.drawGraph();
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("graph") || changedProperties.has("theme") || changedProperties.has("layout")) {
      this.drawGraph();
      return;
    }
    if (changedProperties.has("selectedNodeId")) {
      this.updateSelectionStyles();
    }
  }

  override disconnectedCallback(): void {
    this.simulation?.stop();
    super.disconnectedCallback();
  }

  private drawGraph(): void {
    this.simulation?.stop();
    if (!this.svgSelection || !this.canvasSelection) {
      return;
    }

    this.svgSelection.selectAll("defs").remove();
    this.canvasSelection.selectAll("*").remove();
    this.nodeSelection = undefined;
    this.labelSelection = undefined;

    const graph = this.graph;
    if (!graph || graph.nodes.length === 0) {
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

    if (this.layout === "tree") {
      this.drawTreeGraph(graph, width, height);
      return;
    }

    this.drawForceGraph(graph);
  }

  private createDefs(): void {
    if (!this.svgSelection) {
      return;
    }

    const defs = this.svgSelection.append("defs");
    defs
      .append("marker")
      .attr("id", "projection-ast-arrow")
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

  private drawForceGraph(graph: ProjectionAstGraphResponse): void {
    if (!this.canvasSelection || !this.svgSelection) {
      return;
    }

    const nodes: SimNode[] = graph.nodes.map((node, index) => ({
      ...node,
      x: Math.cos((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * (120 + (index % 6) * 24),
      y: Math.sin((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * (120 + (index % 6) * 24)
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.links
      .map((link): SimLink | undefined => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target) {
          return undefined;
        }
        return {
          ...link,
          source,
          target
        };
      })
      .filter((link): link is SimLink => link !== undefined);

    const linkSelection = this.canvasSelection
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.76)
      .attr("stroke-width", 1.2)
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links)
      .join("path")
      .attr("stroke", (link) => this.linkColor(link.type, link.external))
      .attr("marker-end", (link) => (link.type === "child" ? null : "url(#projection-ast-arrow)"));

    this.nodeSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, node) => {
            if (!event.active) {
              this.simulation?.alphaTarget(0.24).restart();
            }
            node.fx = node.x;
            node.fy = node.y;
          })
          .on("drag", (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
          })
          .on("end", (event, node) => {
            if (!event.active) {
              this.simulation?.alphaTarget(0);
            }
            node.fx = null;
            node.fy = null;
          })
      )
      .on("click", (_, node) => {
        this.emitNodeSelection(node);
      });

    this.nodeSelection
      .append("circle")
      .attr("r", (node) => this.nodeRadius(node))
      .attr("fill", (node) => this.nodeColor(node))
      .attr("stroke", this.themeColor("--theme-graph-outline", "15 23 42"))
      .attr("stroke-width", 1.2);

    this.nodeSelection
      .append("title")
      .text((node) => `${node.astType}\n${node.label}${node.location?.line ? `\nL${node.location.line}` : ""}`);

    this.labelSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes.filter((node) => this.shouldRenderLabel(node)))
      .join("text")
      .attr("font-size", 9)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace");
    this.renderNodeLabels(this.labelSelection, "force");

    this.simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance((link) => (link.type === "child" ? 52 : link.external ? 120 : 92))
          .strength((link) => (link.type === "child" ? 0.9 : 0.3))
      )
      .force("charge", d3.forceManyBody<SimNode>().strength((node) => (node.external ? -260 : -170)))
      .force("collision", d3.forceCollide<SimNode>().radius((node) => this.nodeRadius(node) + 10))
      .force("center", d3.forceCenter(0, 0))
      .force("x", d3.forceX<SimNode>((node) => this.nodeTargetX(node)).strength(0.08))
      .force("y", d3.forceY<SimNode>(0).strength(0.04))
      .on("tick", () => {
        linkSelection.attr("d", (link) => this.arcPath(link));
        this.nodeSelection?.attr("transform", (node) => `translate(${node.x},${node.y})`);
        if (this.labelSelection) {
          this.renderNodeLabels(this.labelSelection, "force");
        }
      });

    this.svgSelection.call(this.zoomBehavior.transform, d3.zoomIdentity);
    this.updateSelectionStyles();
  }

  private drawTreeGraph(graph: ProjectionAstGraphResponse, width: number, height: number): void {
    if (!this.canvasSelection || !this.svgSelection) {
      return;
    }

    const nodeById = new Map<string, PositionedNode>(
      graph.nodes.map((node) => [
        node.id,
        {
          ...node,
          x: 0,
          y: 0
        }
      ])
    );

    const childLinks = this.resolveRenderLinks(nodeById, graph.links.filter((link) => link.type === "child"));
    const overlayLinks = this.resolveRenderLinks(nodeById, graph.links.filter((link) => link.type !== "child"));
    const hierarchy = this.buildTreeHierarchy(graph.nodes, nodeById, childLinks);
    const descendants = hierarchy.descendants().filter((node) => node.depth > 0 && node.data.node);

    if (descendants.length === 0) {
      this.drawForceGraph(graph);
      return;
    }

    const minTreeX = d3.min(descendants, (node) => node.y) ?? 0;
    const maxTreeX = d3.max(descendants, (node) => node.y) ?? 0;
    const minTreeY = d3.min(descendants, (node) => node.x) ?? 0;
    const maxTreeY = d3.max(descendants, (node) => node.x) ?? 0;
    const treeCenterX = (minTreeX + maxTreeX) / 2;
    const treeCenterY = (minTreeY + maxTreeY) / 2;
    const positionedNodes: PositionedNode[] = [];

    for (const descendant of descendants) {
      const node = descendant.data.node;
      if (!node) {
        continue;
      }
      const positionedNode = nodeById.get(node.id);
      if (!positionedNode) {
        continue;
      }
      positionedNode.x = (descendant.y ?? 0) - treeCenterX;
      positionedNode.y = (descendant.x ?? 0) - treeCenterY;
      positionedNodes.push(positionedNode);
    }

    const childLinkGenerator = d3
      .linkHorizontal<RenderLink, PositionedNode>()
      .x((node) => node.x)
      .y((node) => node.y);

    this.canvasSelection
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.72)
      .attr("stroke-width", 1.2)
      .selectAll<SVGPathElement, RenderLink>("path")
      .data(childLinks)
      .join("path")
      .attr("stroke", (link) => this.linkColor(link.type, link.external))
      .attr("d", (link) => childLinkGenerator(link) ?? "");

    this.canvasSelection
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.8)
      .attr("stroke-width", 1.2)
      .selectAll<SVGPathElement, RenderLink>("path")
      .data(overlayLinks)
      .join("path")
      .attr("stroke", (link) => this.linkColor(link.type, link.external))
      .attr("stroke-dasharray", (link) => (link.type === "external" ? "4 3" : "2 3"))
      .attr("marker-end", "url(#projection-ast-arrow)")
      .attr("d", (link) => this.treeOverlayPath(link));

    this.nodeSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGGElement, PositionedNode>("g")
      .data(positionedNodes)
      .join("g")
      .attr("transform", (node) => `translate(${node.x},${node.y})`)
      .style("cursor", "pointer")
      .on("click", (_, node) => {
        this.emitNodeSelection(node);
      });

    this.nodeSelection
      .append("circle")
      .attr("r", (node) => this.nodeRadius(node))
      .attr("fill", (node) => this.nodeColor(node))
      .attr("stroke", this.themeColor("--theme-graph-outline", "15 23 42"))
      .attr("stroke-width", 1.2);

    this.nodeSelection
      .append("title")
      .text((node) => `${node.astType}\n${node.label}${node.location?.line ? `\nL${node.location.line}` : ""}`);

    this.labelSelection = this.canvasSelection
      .append("g")
      .selectAll<SVGTextElement, PositionedNode>("text")
      .data(positionedNodes.filter((node) => this.shouldRenderLabel(node)))
      .join("text")
      .attr("font-size", 9)
      .attr("font-family", "SFMono-Regular, ui-monospace, monospace");
    this.renderNodeLabels(this.labelSelection, "tree");

    this.applyFitTransform(positionedNodes, width, height, {
      padding: 52,
      extraRight: TREE_LABEL_WIDTH
    });
    this.updateSelectionStyles();
  }

  private buildTreeHierarchy(
    nodes: ProjectionAstGraphNode[],
    nodeById: Map<string, PositionedNode>,
    childLinks: RenderLink[]
  ): d3.HierarchyNode<TreeHierarchyDatum> {
    const childrenByParent = new Map<string, string[]>();
    const childIds = new Set<string>();

    for (const link of childLinks) {
      const children = childrenByParent.get(link.source.id) ?? [];
      children.push(link.target.id);
      childrenByParent.set(link.source.id, children);
      childIds.add(link.target.id);
    }

    const sortedRoots = nodes
      .filter((node) => !childIds.has(node.id))
      .sort((left, right) => this.treeNodeSort(left, right));
    const rootNodes = sortedRoots.length > 0 ? sortedRoots : nodes.slice(0, 1);

    const buildDatum = (nodeId: string): TreeHierarchyDatum => {
      const node = nodeById.get(nodeId);
      const childNodeIds = [...(childrenByParent.get(nodeId) ?? [])].sort((left, right) => {
        const leftNode = nodeById.get(left);
        const rightNode = nodeById.get(right);
        if (!leftNode || !rightNode) {
          return left.localeCompare(right);
        }
        return this.treeNodeSort(leftNode, rightNode);
      });

      return {
        id: nodeId,
        node,
        children: childNodeIds.map((childId) => buildDatum(childId))
      };
    };

    const rootDatum: TreeHierarchyDatum = {
      id: "__virtual__",
      children: rootNodes.map((node) => buildDatum(node.id))
    };

    const hierarchy = d3.hierarchy(rootDatum, (datum) => datum.children);
    return d3
      .tree<TreeHierarchyDatum>()
      .nodeSize([TREE_VERTICAL_GAP, TREE_HORIZONTAL_GAP])
      .separation((left, right) => (left.parent === right.parent ? 1 : 1.15))(hierarchy);
  }

  private resolveRenderLinks(
    nodeById: Map<string, PositionedNode>,
    links: ProjectionAstGraphLink[]
  ): RenderLink[] {
    return links
      .map((link): RenderLink | undefined => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target) {
          return undefined;
        }
        return {
          ...link,
          source,
          target
        };
      })
      .filter((link): link is RenderLink => link !== undefined);
  }

  private treeOverlayPath(link: RenderLink): string {
    const sourceX = link.source.x;
    const sourceY = link.source.y;
    const targetX = link.target.x;
    const targetY = link.target.y;
    const controlX = Math.max(sourceX, targetX) + Math.abs(targetX - sourceX) * 0.3 + 24;
    return `M${sourceX},${sourceY}C${controlX},${sourceY} ${controlX},${targetY} ${targetX},${targetY}`;
  }

  private applyFitTransform(
    nodes: PositionedNode[],
    width: number,
    height: number,
    options?: {
      padding?: number;
      extraRight?: number;
      extraBottom?: number;
    }
  ): void {
    if (!this.svgSelection || nodes.length === 0) {
      return;
    }

    const padding = options?.padding ?? 36;
    const minX = (d3.min(nodes, (node) => node.x) ?? 0) - 32;
    const maxX = (d3.max(nodes, (node) => node.x) ?? 0) + 32 + (options?.extraRight ?? 0);
    const minY = (d3.min(nodes, (node) => node.y) ?? 0) - 32;
    const maxY = (d3.max(nodes, (node) => node.y) ?? 0) + 32 + (options?.extraBottom ?? 0);
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight)
      )
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.svgSelection.call(
      this.zoomBehavior.transform,
      d3.zoomIdentity.translate(-centerX * scale, -centerY * scale).scale(scale)
    );
  }

  private emitNodeSelection(node: ProjectionAstGraphNode): void {
    this.dispatchEvent(
      new CustomEvent("projection-ast-node-select", {
        detail: {
          nodeId: node.id,
          path: node.path,
          location: node.location
        },
        bubbles: true,
        composed: true
      })
    );
  }

  private renderNodeLabels(
    selection: d3.Selection<SVGTextElement, PositionedNode, SVGGElement, unknown>,
    layout: ProjectionAstLayout
  ): void {
    const primaryColor = this.themeColor("--theme-graph-text", "226 232 240");
    const secondaryColor = this.themeColor("--theme-graph-arrow", "148 163 184");

    selection
      .attr("fill", primaryColor)
      .attr("text-anchor", layout === "tree" ? "start" : "middle")
      .each((node, index, elements) => {
        const text = d3.select(elements[index]);
        const baseX = layout === "tree" ? node.x + this.nodeRadius(node) + 6 : node.x;
        const baseY = layout === "tree" ? node.y - 2 : node.y + this.nodeRadius(node) + 12;
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

  private nodeLabelLines(node: ProjectionAstGraphNode): string[] {
    const lines = [node.astType];
    if (node.label && node.label !== node.astType) {
      lines.push(node.label);
    }
    return lines;
  }

  private treeNodeSort(left: ProjectionAstGraphNode, right: ProjectionAstGraphNode): number {
    if (left.external !== right.external) {
      return left.external ? 1 : -1;
    }
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }
    return left.label.localeCompare(right.label);
  }

  private updateSelectionStyles(): void {
    if (!this.nodeSelection) {
      return;
    }

    this.nodeSelection
      .selectAll<SVGCircleElement, PositionedNode>("circle")
      .attr("stroke", (node) => node.id === this.selectedNodeId
        ? this.themeColor("--theme-graph-selection", "125 211 252")
        : this.themeColor("--theme-graph-outline", "15 23 42"))
      .attr("stroke-width", (node) => (node.id === this.selectedNodeId ? 2.4 : 1.2))
      .attr("opacity", (node) => (this.selectedNodeId && node.id !== this.selectedNodeId ? 0.9 : 1));
  }

  private arcPath(link: SimLink): string {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    const x1 = source.x ?? 0;
    const y1 = source.y ?? 0;
    const x2 = target.x ?? 0;
    const y2 = target.y ?? 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dr = Math.max(36, Math.hypot(dx, dy) * 1.08);
    return `M${x1},${y1}A${dr},${dr} 0 0,1 ${x2},${y2}`;
  }

  private nodeRadius(node: ProjectionAstGraphNode): number {
    if (node.category === "root") {
      return 14;
    }
    if (node.external) {
      return 9;
    }
    if (node.category === "declaration" || node.category === "member") {
      return 8;
    }
    return 6;
  }

  private shouldRenderLabel(node: ProjectionAstGraphNode): boolean {
    return node.category === "root" || node.category === "declaration" || node.category === "member" || node.external;
  }

  private nodeTargetX(node: ProjectionAstGraphNode): number {
    if (node.external) {
      return 220;
    }
    if (node.category === "root") {
      return -180;
    }
    if (node.category === "declaration" || node.category === "member") {
      return -40;
    }
    return 120;
  }

  private nodeColor(node: ProjectionAstGraphNode): string {
    if (node.external) {
      return this.themeColor("--theme-graph-selection", "125 211 252");
    }
    if (node.category === "root") {
      return this.themeColor("--theme-graph-node-root", "217 119 6");
    }
    if (node.category === "declaration") {
      return this.themeColor("--theme-graph-node-java", "34 197 94");
    }
    if (node.category === "member") {
      return this.themeColor("--theme-graph-node-jsp", "14 165 233");
    }
    if (node.category === "statement" || node.category === "scriptlet") {
      return this.themeColor("--theme-graph-node-unresolved", "244 114 182");
    }
    return this.themeColor("--theme-graph-arrow", "91 119 184");
  }

  private linkColor(type: ProjectionAstGraphLink["type"], external: boolean): string {
    if (external || type === "external") {
      return this.themeColor("--theme-graph-selection", "125 211 252");
    }
    if (type === "call") {
      return "rgb(251 191 36)";
    }
    if (type === "reference") {
      return "rgb(248 113 113)";
    }
    return this.themeColor("--theme-graph-arrow", "91 119 184");
  }

  private themeColor(variable: string, fallbackTriplet: string): string {
    const computed = getComputedStyle(this);
    const triplet = computed.getPropertyValue(variable).trim() || fallbackTriplet;
    return `rgb(${triplet})`;
  }
}

customElements.define("projection-ast-graph", ProjectionAstGraph);

declare global {
  interface HTMLElementTagNameMap {
    "projection-ast-graph": ProjectionAstGraph;
  }
}
