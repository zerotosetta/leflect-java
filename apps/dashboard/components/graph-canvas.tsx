"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";

import { DashboardNodeSummary, DashboardVisibleEdge, DashboardVisibleGraphResponse } from "@leflect-java/dashboard-data";

type GraphCanvasProps = {
  graph: DashboardVisibleGraphResponse;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onSelectZone: (zoneId: string) => void;
  onExpandZone: (zoneId: string) => void;
};

type HoveredNode = {
  id: string;
  label: string;
  detail: string;
};

type SigmaEventPayload = {
  node?: string;
  event?: {
    preventSigmaDefault: () => void;
  };
};

type SigmaReducerPayload = Record<string, unknown> & {
  color?: string;
  size?: number;
  highlighted?: boolean;
};

type SigmaInstance = {
  on: (event: string, handler: (payload: SigmaEventPayload) => void) => void;
  setSetting: (
    name: string,
    reducer: (node: string, data: SigmaReducerPayload) => SigmaReducerPayload
  ) => void;
  kill: () => void;
};

export function GraphCanvas({ graph, selectedNodeId, onSelectNode, onSelectZone, onExpandZone }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<SigmaInstance | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const graphModel = useMemo(() => createGraphModel(graph), [graph]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let active = true;
    let renderer: SigmaInstance | null = null;

    void import("sigma").then(({ default: Sigma }) => {
      if (!active || !containerRef.current) {
        return;
      }

      renderer = new Sigma(graphModel, containerRef.current, {
        renderEdgeLabels: true,
        labelRenderedSizeThreshold: 7,
        defaultNodeType: "circle",
        defaultEdgeType: "line",
        allowInvalidContainer: true
      }) as unknown as SigmaInstance;

      renderer.on("clickNode", ({ node }) => {
        if (!node) {
          return;
        }
        if (String(node).startsWith("zone:")) {
          onSelectZone(String(node).slice("zone:".length));
          return;
        }
        onSelectNode(String(node));
      });

      renderer.on("doubleClickNode", ({ node, event }) => {
        if (!node || !event) {
          return;
        }
        event.preventSigmaDefault();
        if (String(node).startsWith("zone:")) {
          onExpandZone(String(node).slice("zone:".length));
        }
      });

      renderer.on("enterNode", ({ node }) => {
        if (!node) {
          return;
        }
        const attributes = graphModel.getNodeAttributes(node);
        setHoveredNode({
          id: String(node),
          label: String(attributes.label ?? node),
          detail: String(attributes.detail ?? "")
        });
      });
      renderer.on("leaveNode", () => setHoveredNode(null));

      renderer.setSetting("nodeReducer", (node, data) => {
        const reduced = { ...data };
        if (node === selectedNodeId) {
          reduced.highlighted = true;
          reduced.color = "#ffe082";
          reduced.size = Number(data.size ?? 10) + 3;
        }
        return reduced;
      });

      sigmaRef.current = renderer;
    });

    return () => {
      active = false;
      setHoveredNode(null);
      sigmaRef.current = null;
      renderer?.kill();
    };
  }, [graphModel, onExpandZone, onSelectNode, onSelectZone, selectedNodeId]);

  return (
    <div className="graph-shell">
      <div ref={containerRef} className="graph-canvas" />
      {hoveredNode ? (
        <div className="graph-tooltip">
          <strong>{hoveredNode.label}</strong>
          <span>{hoveredNode.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

function createGraphModel(graph: DashboardVisibleGraphResponse) {
  const model = new Graph();
  const positions = assignPositions(graph.nodes, graph.edges, graph.entryId);

  for (const node of graph.nodes) {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    model.addNode(node.id, {
      x: position.x,
      y: position.y,
      size: resolveNodeSize(node),
      color: resolveNodeColor(node),
      label: node.label,
      detail: `${node.kind} · in ${node.incomingCount} · out ${node.outgoingCount}`
    });
  }

  for (const edge of graph.edges) {
    if (!model.hasNode(edge.source) || !model.hasNode(edge.target)) {
      continue;
    }
    const key = edge.id;
    model.addEdgeWithKey(key, edge.source, edge.target, {
      size: Math.max(1, Math.min(8, Math.log2(edge.count + 1) + 1)),
      color: resolveEdgeColor(edge),
      label: edge.count > 1 ? `${edge.count}` : edge.edgeTypes[0] ?? "edge"
    });
  }

  return model;
}

function assignPositions(
  nodes: DashboardNodeSummary[],
  edges: DashboardVisibleEdge[],
  entryId?: string
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const depth = new Map<string, number>();
  const queue = entryId && adjacency.has(entryId) ? [entryId] : nodes.map((node) => node.id).slice(0, 1);
  for (const start of queue) {
    depth.set(start, 0);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const currentDepth = depth.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (depth.has(next)) {
        continue;
      }
      depth.set(next, currentDepth + 1);
      queue.push(next);
    }
  }

  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, (depth.get(entryId ?? "") ?? 0) + 1);
    }
  }

  const byDepth = new Map<number, DashboardNodeSummary[]>();
  for (const node of nodes) {
    const nodeDepth = depth.get(node.id) ?? 0;
    const entries = byDepth.get(nodeDepth) ?? [];
    entries.push(node);
    byDepth.set(nodeDepth, entries);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const depthEntries = [...byDepth.entries()].sort((left, right) => left[0] - right[0]);
  for (const [column, [, columnNodes]] of depthEntries.entries()) {
    const sorted = columnNodes.sort((left, right) => left.label.localeCompare(right.label));
    sorted.forEach((node, row) => {
      const offset = (sorted.length - 1) / 2;
      positions.set(node.id, {
        x: column * 260,
        y: (row - offset) * 150
      });
    });
  }

  return positions;
}

function resolveNodeSize(node: DashboardNodeSummary): number {
  if (node.isEntry) {
    return 18;
  }
  if (node.kind === "zone") {
    return 14 + Math.min(10, Math.log2((node.hiddenChildrenCount ?? 1) + 1) * 3);
  }
  if (node.nodeType === "jsp") {
    return 12;
  }
  if (node.nodeType === "unresolved") {
    return 8;
  }
  return 10;
}

function resolveNodeColor(node: DashboardNodeSummary): string {
  if (node.isEntry) {
    return "#ffb86c";
  }
  if (node.kind === "zone") {
    return node.summarized ? "#50fa7b" : "#8be9fd";
  }
  if (node.nodeType === "jsp") {
    return "#ff6b6b";
  }
  if (node.nodeType === "unresolved") {
    return "#7f8ea3";
  }
  return "#46d9b8";
}

function resolveEdgeColor(edge: DashboardVisibleEdge): string {
  if (edge.edgeTypes.includes("JSP_SCRIPTLET_CALL")) {
    return "rgba(255, 107, 107, 0.55)";
  }
  if (edge.edgeTypes.includes("JSP_USES_TAG")) {
    return "rgba(241, 250, 140, 0.55)";
  }
  return "rgba(139, 233, 253, 0.4)";
}
