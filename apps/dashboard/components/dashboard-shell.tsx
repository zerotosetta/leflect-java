"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DashboardBootstrap,
  DashboardEntry,
  DashboardNodeDetail,
  DashboardPolicy,
  DashboardVisibleGraphResponse,
  DashboardZoneSummary,
  GraphEdgeType
} from "@leflect-java/dashboard-data";

import { GraphCanvas } from "@/components/graph-canvas";

type DashboardShellProps = {
  bootstrap: DashboardBootstrap;
};

type ViewMode = "flow" | "matrix" | "impact" | "cycle";

const EDGE_TYPES: GraphEdgeType[] = ["JAVA_CALL", "JSP_SCRIPTLET_CALL", "JSP_USES_TAG"];

export function DashboardShell({ bootstrap }: DashboardShellProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("flow");
  const [activeTab, setActiveTab] = useState<"entries" | "policies" | "zones" | "filters">("entries");
  const [entryQuery, setEntryQuery] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState(bootstrap.defaultEntryId ?? bootstrap.entries[0]?.id);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [selectedZoneId, setSelectedZoneId] = useState<string | undefined>(undefined);
  const [policies, setPolicies] = useState<DashboardPolicy[]>(bootstrap.policies);
  const [graph, setGraph] = useState<DashboardVisibleGraphResponse>(bootstrap.defaultVisibleGraph);
  const [nodeDetail, setNodeDetail] = useState<DashboardNodeDetail | null>(null);
  const [zoneDetail, setZoneDetail] = useState<DashboardZoneSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Array<{ zoneId: string; action: "EXPAND" | "COLLAPSE" | "SUMMARIZE" | "HIDE" }>>([]);
  const [filters, setFilters] = useState({
    maxDepth: 4,
    edgeTypes: EDGE_TYPES,
    includeHidden: false,
    sharedNodesOnly: false,
    entrySpecificOnly: false,
    cycleOnly: false,
    search: ""
  });

  const filteredEntries = useMemo(() => {
    const query = entryQuery.trim().toLowerCase();
    return bootstrap.entries.filter((entry) => {
      if (!query) {
        return true;
      }
      return [entry.label, entry.path, entry.classId, entry.packageName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [bootstrap.entries, entryQuery]);

  const groupedEntries = useMemo(() => groupEntries(filteredEntries), [filteredEntries]);
  const activePolicyIds = useMemo(
    () => policies.filter((entry) => entry.enabled).map((entry) => entry.id),
    [policies]
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const nextGraph = await requestJson<DashboardVisibleGraphResponse>("/api/graph/visible", {
        method: "POST",
        body: JSON.stringify({
          entryId: selectedEntryId,
          activePolicyIds,
          manualOverrides,
          filters
        })
      });
      if (!cancelled) {
        setGraph(nextGraph);
        setLoading(false);
      }
    }
    void run().catch((error) => {
      if (!cancelled) {
        setLoading(false);
        setStatusMessage((error as Error).message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activePolicyIds, filters, manualOverrides, selectedEntryId]);

  useEffect(() => {
    if (!selectedNodeId) {
      setNodeDetail(null);
      return;
    }
    if (selectedNodeId.startsWith("zone:")) {
      return;
    }
    let cancelled = false;
    void requestJson<DashboardNodeDetail>(`/api/nodes/${encodeURIComponent(selectedNodeId)}`)
      .then((detail) => {
        if (!cancelled) {
          setNodeDetail(detail);
          setZoneDetail(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage((error as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  useEffect(() => {
    if (!selectedZoneId) {
      setZoneDetail(null);
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams();
    if (selectedEntryId) {
      query.set("entryId", selectedEntryId);
    }
    query.set("maxDepth", String(filters.maxDepth));
    for (const policyId of activePolicyIds) {
      query.append("activePolicyId", policyId);
    }
    for (const edgeType of filters.edgeTypes) {
      query.append("edgeType", edgeType);
    }
    void requestJson<DashboardZoneSummary>(`/api/zones/${encodeURIComponent(selectedZoneId)}/summary?${query.toString()}`)
      .then((detail) => {
        if (!cancelled) {
          setZoneDetail(detail);
          setNodeDetail(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage((error as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePolicyIds, filters.edgeTypes, filters.maxDepth, selectedEntryId, selectedZoneId]);

  async function persistPolicies(nextPolicies: DashboardPolicy[]) {
    setPolicies(nextPolicies);
    const response = await requestJson<{ policies: DashboardPolicy[] }>("/api/policies", {
      method: "PUT",
      body: JSON.stringify({ policies: nextPolicies })
    });
    setPolicies(response.policies);
  }

  function updatePolicy(policyId: string, patch: Partial<DashboardPolicy>) {
    const nextPolicies = policies.map((entry) =>
      entry.id === policyId ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry
    );
    void persistPolicies(nextPolicies).catch((error) => setStatusMessage((error as Error).message));
  }

  function toggleEdgeType(edgeType: GraphEdgeType) {
    setFilters((current) => {
      const next = current.edgeTypes.includes(edgeType)
        ? current.edgeTypes.filter((entry) => entry !== edgeType)
        : [...current.edgeTypes, edgeType];
      return {
        ...current,
        edgeTypes: next.length > 0 ? next : EDGE_TYPES
      };
    });
  }

  function saveCurrentView() {
    if (typeof window === "undefined") {
      return;
    }
    const payload = {
      selectedEntryId,
      activePolicyIds,
      filters,
      manualOverrides,
      viewMode
    };
    window.localStorage.setItem("leflect-dashboard-view", JSON.stringify(payload));
    setStatusMessage("Current view saved to localStorage.");
  }

  function applyZoneOverride(zoneId: string, action: "EXPAND" | "COLLAPSE" | "SUMMARIZE" | "HIDE") {
    setManualOverrides((current) => {
      const rest = current.filter((entry) => entry.zoneId !== zoneId);
      return [...rest, { zoneId, action }];
    });
  }

  function clearZoneOverride(zoneId: string) {
    setManualOverrides((current) => current.filter((entry) => entry.zoneId !== zoneId));
  }

  const selectedEntry = bootstrap.entries.find((entry) => entry.id === selectedEntryId);
  const selectedGraphZone = selectedZoneId ? graph.zones.find((entry) => entry.id === selectedZoneId) : undefined;
  const selectedGraphNode = selectedNodeId ? graph.nodes.find((entry) => entry.id === selectedNodeId) : undefined;

  return (
    <main className="dashboard-root">
      <section className="top-bar panel">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{bootstrap.projectName}</h1>
          <p className="muted mono">{bootstrap.analysisOut}</p>
        </div>
        <div className="top-actions">
          <label className="field-stack">
            <span>Entry Search</span>
            <input
              value={entryQuery}
              onChange={(event) => setEntryQuery(event.target.value)}
              placeholder="jsp, controller, package"
            />
          </label>
          <label className="field-stack compact">
            <span>View Mode</span>
            <div className="segmented">
              {([
                ["flow", "Flow Graph"],
                ["matrix", "Matrix"],
                ["impact", "Impact"],
                ["cycle", "Cycle"]
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  className={viewMode === mode ? "active" : undefined}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <button className="primary" onClick={saveCurrentView}>Save View</button>
        </div>
      </section>

      <section className="active-policy-strip panel">
        <div>
          <p className="eyebrow">Active Policies</p>
          <div className="badge-row">
            {policies.filter((entry) => entry.enabled).map((entry) => (
              <span key={entry.id} className="badge accent">{entry.name}</span>
            ))}
          </div>
        </div>
        <div className="summary-grid">
          <span>Entries {bootstrap.entries.length}</span>
          <span>Zones {graph.zones.length}</span>
          <span>Visible Nodes {graph.stats.visibleNodeCount}</span>
          <span>Visible Edges {graph.stats.visibleEdgeCount}</span>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="left-sidebar panel">
          <div className="sidebar-tabs segmented vertical">
            <button className={activeTab === "entries" ? "active" : undefined} onClick={() => setActiveTab("entries")}>Entries</button>
            <button className={activeTab === "policies" ? "active" : undefined} onClick={() => setActiveTab("policies")}>Policies</button>
            <button className={activeTab === "zones" ? "active" : undefined} onClick={() => setActiveTab("zones")}>Zones</button>
            <button className={activeTab === "filters" ? "active" : undefined} onClick={() => setActiveTab("filters")}>Filters</button>
          </div>

          {activeTab === "entries" ? (
            <div className="sidebar-section">
              {groupedEntries.map(([group, entries]) => (
                <div key={group} className="entry-group">
                  <h3>{group}</h3>
                  <ul>
                    {entries.map((entry) => (
                      <li key={`${group}:${entry.id}`}>
                        <button
                          className={selectedEntryId === entry.id ? "selected" : undefined}
                          onClick={() => {
                            setSelectedEntryId(entry.id);
                            setSelectedNodeId(undefined);
                            setSelectedZoneId(undefined);
                          }}
                        >
                          <strong>{entry.label}</strong>
                          <span>{entry.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "policies" ? (
            <div className="sidebar-section policy-list">
              {policies.map((policy) => (
                <article key={policy.id} className="policy-card">
                  <div className="policy-card-head">
                    <div>
                      <strong>{policy.name}</strong>
                      <p className="muted">{policy.scope} · priority {policy.priority}</p>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={policy.enabled}
                        onChange={(event) => updatePolicy(policy.id, { enabled: event.target.checked })}
                      />
                      <span>{policy.enabled ? "ON" : "OFF"}</span>
                    </label>
                  </div>
                  <ul className="rule-list">
                    {policy.rules.map((rule) => (
                      <li key={rule.id}>
                        <span>{rule.action.type}</span>
                        <strong>{rule.match?.zonePatterns?.join(", ") ?? "**"}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : null}

          {activeTab === "zones" ? (
            <div className="sidebar-section zone-list">
              {graph.zones.map((zone) => (
                <article key={zone.id} className="zone-card">
                  <div>
                    <strong>{zone.label}</strong>
                    <p className="muted">{zone.classCount} classes · {zone.methodCount} methods</p>
                  </div>
                  <div className="badge-row">
                    <span className="badge">{zone.action}</span>
                    <span className="badge">fanIn {zone.fanIn}</span>
                  </div>
                  <div className="zone-actions">
                    {(["EXPAND", "COLLAPSE", "SUMMARIZE", "HIDE"] as const).map((action) => (
                      <button key={action} onClick={() => applyZoneOverride(zone.id, action)}>{action}</button>
                    ))}
                    <button onClick={() => clearZoneOverride(zone.id)}>Reset</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {activeTab === "filters" ? (
            <div className="sidebar-section filter-list">
              <label className="field-stack">
                <span>Graph Search</span>
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="class, jsp, zone"
                />
              </label>
              <label className="field-stack">
                <span>Depth {filters.maxDepth}</span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={filters.maxDepth}
                  onChange={(event) => setFilters((current) => ({ ...current, maxDepth: Number.parseInt(event.target.value, 10) }))}
                />
              </label>
              <fieldset>
                <legend>Edge Types</legend>
                {EDGE_TYPES.map((edgeType) => (
                  <label key={edgeType} className="check-row">
                    <input
                      type="checkbox"
                      checked={filters.edgeTypes.includes(edgeType)}
                      onChange={() => toggleEdgeType(edgeType)}
                    />
                    <span>{edgeType}</span>
                  </label>
                ))}
              </fieldset>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={filters.sharedNodesOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, sharedNodesOnly: event.target.checked }))}
                />
                <span>Shared node only</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={filters.entrySpecificOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, entrySpecificOnly: event.target.checked }))}
                />
                <span>Entry specific only</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={filters.cycleOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, cycleOnly: event.target.checked }))}
                />
                <span>Cycle only</span>
              </label>
            </div>
          ) : null}
        </aside>

        <section className="graph-panel panel">
          <header className="graph-panel-head">
            <div>
              <p className="eyebrow">Selected Entry</p>
              <h2>{selectedEntry?.label ?? "No entry selected"}</h2>
              <p className="muted mono">{selectedEntry?.path}</p>
            </div>
            <div className="badge-row">
              <span className="badge">Depth {filters.maxDepth}</span>
              <span className="badge">{loading ? "Refreshing" : graph.stats.cacheHit ? "Cache Hit" : "Live"}</span>
            </div>
          </header>
          <div className="graph-stage">
            {viewMode === "flow" ? (
              <GraphCanvas
                graph={graph}
                selectedNodeId={selectedNodeId}
                onSelectNode={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedZoneId(undefined);
                }}
                onSelectZone={(zoneId) => {
                  setSelectedZoneId(zoneId);
                  setSelectedNodeId(`zone:${zoneId}`);
                }}
                onExpandZone={(zoneId) => applyZoneOverride(zoneId, "EXPAND")}
              />
            ) : null}

            {viewMode === "matrix" ? <MatrixView graph={graph} /> : null}
            {viewMode === "impact" ? <ImpactView graph={graph} /> : null}
            {viewMode === "cycle" ? <CycleView graph={graph} /> : null}
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="detail-block">
            <p className="eyebrow">Selection</p>
            {zoneDetail ?? selectedGraphZone ? (
              <ZoneDetailView detail={zoneDetail ?? selectedGraphZone!} />
            ) : nodeDetail ?? selectedGraphNode ? (
              <NodeDetailView detail={nodeDetail} fallbackNode={selectedGraphNode} />
            ) : (
              <EmptyDetail selectedEntry={selectedEntry} />
            )}
          </div>
          <div className="detail-block">
            <p className="eyebrow">Policy Trace</p>
            <ul className="trace-list">
              {(zoneDetail?.traces ?? selectedGraphZone?.traces ?? graph.policyTrace.slice(0, 8)).map((trace) => (
                <li key={`${trace.policyId}:${trace.ruleId}`}>
                  <strong>{trace.policyName}</strong>
                  <span>{trace.ruleName}</span>
                  <em>{trace.action}</em>
                </li>
              ))}
            </ul>
          </div>
          {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}
        </aside>
      </section>

      <footer className="status-bar panel mono">
        <span>Nodes {graph.stats.visibleNodeCount}</span>
        <span>Edges {graph.stats.visibleEdgeCount}</span>
        <span>Hidden {graph.stats.hiddenNodeCount}</span>
        <span>Collapsed {graph.stats.collapsedZoneCount}</span>
        <span>Render {graph.stats.renderTimeMs}ms</span>
        <span>Last Index {bootstrap.summary.generatedAt}</span>
      </footer>
    </main>
  );
}

function groupEntries(entries: DashboardEntry[]): Array<[string, DashboardEntry[]]> {
  const groups = new Map<string, DashboardEntry[]>();
  for (const entry of entries) {
    const key = entry.type.toUpperCase();
    const values = groups.get(key) ?? [];
    values.push(entry);
    groups.set(key, values);
  }
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function MatrixView({ graph }: { graph: DashboardVisibleGraphResponse }) {
  return (
    <div className="matrix-view">
      <table>
        <thead>
          <tr>
            <th />
            {graph.matrix.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {graph.matrix.rows.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {graph.matrix.columns.map((column) => (
                <td key={`${row}:${column}`}>{graph.matrix.values[`${row}::${column}`] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImpactView({ graph }: { graph: DashboardVisibleGraphResponse }) {
  if (!graph.impact) {
    return <div className="empty-state">Select an entry to calculate impact.</div>;
  }
  return (
    <div className="impact-grid">
      <article className="impact-card">
        <strong>Forward Impact</strong>
        <span>{graph.impact.forwardCount} nodes</span>
        <p>{graph.impact.forwardNodes.join(", ") || "-"}</p>
      </article>
      <article className="impact-card">
        <strong>Reverse Impact</strong>
        <span>{graph.impact.reverseCount} nodes</span>
        <p>{graph.impact.reverseNodes.join(", ") || "-"}</p>
      </article>
    </div>
  );
}

function CycleView({ graph }: { graph: DashboardVisibleGraphResponse }) {
  if (graph.cycles.length === 0) {
    return <div className="empty-state">No cycle detected in the visible graph.</div>;
  }
  return (
    <div className="cycle-list">
      {graph.cycles.map((cycle) => (
        <article key={cycle.id} className="cycle-card">
          <strong>{cycle.size} nodes</strong>
          <p>{cycle.nodes.join(" → ")}</p>
        </article>
      ))}
    </div>
  );
}

function NodeDetailView({
  detail,
  fallbackNode
}: {
  detail: DashboardNodeDetail | null;
  fallbackNode: DashboardVisibleGraphResponse["nodes"][number] | undefined;
}) {
  const node = detail?.node ?? fallbackNode;
  if (!node) {
    return null;
  }
  return (
    <div className="detail-stack">
      <h3>{node.label}</h3>
      <p className="muted mono">{node.path ?? node.id}</p>
      <div className="badge-row">
        <span className="badge">{node.nodeType}</span>
        <span className="badge">in {node.incomingCount}</span>
        <span className="badge">out {node.outgoingCount}</span>
      </div>
      {detail ? (
        <>
          <h4>Representative References</h4>
          <ul className="reference-list">
            {detail.representativeReferences.length > 0 ? (
              detail.representativeReferences.map((reference, index) => (
                <li key={`${reference.source}:${reference.target}:${index}`}>
                  <strong>{reference.methodName ?? reference.classPath ?? reference.target}</strong>
                  <span>{reference.snippet ?? reference.target}</span>
                  <em>
                    {reference.location?.line ? `L${reference.location.line}:${reference.location.column ?? 1}` : "n/a"}
                  </em>
                </li>
              ))
            ) : (
              <li>No callsite metadata for the current node.</li>
            )}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ZoneDetailView({ detail }: { detail: DashboardZoneSummary }) {
  return (
    <div className="detail-stack">
      <h3>{detail.label}</h3>
      <div className="badge-row">
        <span className="badge">{detail.action}</span>
        <span className="badge">classes {detail.classCount}</span>
        <span className="badge">methods {detail.methodCount}</span>
      </div>
      <p className="muted">entry coverage {(detail.entryCoverage * 100).toFixed(0)}%</p>
      <h4>Top Classes</h4>
      <ul className="compact-list">
        {detail.topClasses.length > 0 ? detail.topClasses.map((entry) => <li key={entry}>{entry}</li>) : <li>No representative classes.</li>}
      </ul>
      <h4>Representative Path</h4>
      <p className="muted mono">{detail.representativePath.join(" → ") || "No path"}</p>
      <h4>Edge Breakdown</h4>
      <ul className="compact-list">
        {Object.entries(detail.edgeBreakdown).map(([edgeType, count]) => (
          <li key={edgeType}>{edgeType}: {count}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyDetail({ selectedEntry }: { selectedEntry: DashboardEntry | undefined }) {
  return (
    <div className="detail-stack">
      <h3>{selectedEntry?.label ?? "No Selection"}</h3>
      <p className="muted mono">{selectedEntry?.path ?? "Choose an entry or graph node."}</p>
      <p className="muted">Use the graph canvas, entries list, or zone cards to inspect the current visible graph.</p>
    </div>
  );
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(payload.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}
