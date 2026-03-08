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

import { cx } from "@/lib/cx";
import { GraphCanvas } from "@/components/graph-canvas";
import * as styles from "./dashboard-shell.css";

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
    <main className={styles.root}>
      <section className={styles.topBar}>
        <div className={styles.topBarInfo}>
          <p className={styles.eyebrow}>Project</p>
          <h1 className={styles.topBarTitle}>{bootstrap.projectName}</h1>
          <p className={cx(styles.mutedText, styles.monoText, styles.ellipsisText)} title={bootstrap.analysisOut}>
            {bootstrap.analysisOut}
          </p>
        </div>
        <div className={styles.topActions}>
          <label className={styles.fieldStack}>
            <span className={styles.eyebrow}>Entry Search</span>
            <input
              className={styles.textInput}
              value={entryQuery}
              onChange={(event) => setEntryQuery(event.target.value)}
              placeholder="jsp, controller, package"
            />
          </label>
          <label className={cx(styles.fieldStack, styles.fieldCompact)}>
            <span className={styles.eyebrow}>View Mode</span>
            <div className={styles.segmented}>
              {([
                ["flow", "Flow Graph"],
                ["matrix", "Matrix"],
                ["impact", "Impact"],
                ["cycle", "Cycle"]
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  className={cx(styles.segmentedButton, viewMode === mode && styles.segmentedButtonActive)}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <button className={styles.primaryButton} onClick={saveCurrentView}>Save View</button>
        </div>
      </section>

      <section className={styles.policyStrip}>
        <div className={styles.topBarInfo}>
          <p className={styles.eyebrow}>Active Policies</p>
          <div className={styles.badgeRow}>
            {policies.filter((entry) => entry.enabled).map((entry) => (
              <span key={entry.id} className={cx(styles.badge, styles.badgeAccent)}>{entry.name}</span>
            ))}
          </div>
        </div>
        <div className={styles.metricsRow}>
          <span>Entries {bootstrap.entries.length}</span>
          <span>Zones {graph.zones.length}</span>
          <span>Visible Nodes {graph.stats.visibleNodeCount}</span>
          <span>Visible Edges {graph.stats.visibleEdgeCount}</span>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={cx(styles.segmented, styles.segmentedVertical)}>
            <button className={cx(styles.segmentedButton, activeTab === "entries" && styles.segmentedButtonActive)} onClick={() => setActiveTab("entries")}>Entries</button>
            <button className={cx(styles.segmentedButton, activeTab === "policies" && styles.segmentedButtonActive)} onClick={() => setActiveTab("policies")}>Policies</button>
            <button className={cx(styles.segmentedButton, activeTab === "zones" && styles.segmentedButtonActive)} onClick={() => setActiveTab("zones")}>Zones</button>
            <button className={cx(styles.segmentedButton, activeTab === "filters" && styles.segmentedButtonActive)} onClick={() => setActiveTab("filters")}>Filters</button>
          </div>

          {activeTab === "entries" ? (
            <div className={styles.sidebarSection}>
              {groupedEntries.map(([group, entries]) => (
                <div key={group} className={styles.entryGroup}>
                  <h3 className={styles.groupHeading}>{group}</h3>
                  <ul className={styles.stackList}>
                    {entries.map((entry) => (
                      <li key={`${group}:${entry.id}`}>
                        <button
                          className={cx(styles.entryButton, selectedEntryId === entry.id && styles.entryButtonSelected)}
                          onClick={() => {
                            setSelectedEntryId(entry.id);
                            setSelectedNodeId(undefined);
                            setSelectedZoneId(undefined);
                          }}
                        >
                          <strong title={entry.label}>{entry.label}</strong>
                          <span title={entry.path}>{entry.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "policies" ? (
            <div className={cx(styles.sidebarSection, styles.policyList)}>
              {policies.map((policy) => (
                <article key={policy.id} className={styles.policyCard}>
                  <div className={styles.policyHead}>
                    <div className={styles.topBarInfo}>
                      <strong>{policy.name}</strong>
                      <p className={styles.scopeText}>{policy.scope} · priority {policy.priority}</p>
                    </div>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={policy.enabled}
                        onChange={(event) => updatePolicy(policy.id, { enabled: event.target.checked })}
                      />
                      <span>{policy.enabled ? "ON" : "OFF"}</span>
                    </label>
                  </div>
                  <ul className={styles.ruleList}>
                    {policy.rules.map((rule) => (
                      <li key={rule.id} className={styles.ruleItem}>
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
            <div className={cx(styles.sidebarSection, styles.policyList)}>
              {graph.zones.map((zone) => (
                <article key={zone.id} className={styles.zoneCard}>
                  <div className={styles.topBarInfo}>
                    <strong className={styles.ellipsisText} title={zone.label}>{zone.label}</strong>
                    <p className={styles.scopeText}>{zone.classCount} classes · {zone.methodCount} methods</p>
                  </div>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>{zone.action}</span>
                    <span className={styles.badge}>fanIn {zone.fanIn}</span>
                    <span className={styles.badge}>coverage {(zone.entryCoverage * 100).toFixed(0)}%</span>
                  </div>
                  <div className={styles.zoneActions}>
                    {(["EXPAND", "COLLAPSE", "SUMMARIZE", "HIDE"] as const).map((action) => (
                      <button key={action} className={styles.actionButton} onClick={() => applyZoneOverride(zone.id, action)}>{action}</button>
                    ))}
                    <button className={styles.actionButton} onClick={() => clearZoneOverride(zone.id)}>Reset</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {activeTab === "filters" ? (
            <div className={cx(styles.sidebarSection, styles.filterSection)}>
              <label className={styles.fieldStack}>
                <span className={styles.eyebrow}>Graph Search</span>
                <input
                  className={styles.textInput}
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="class, jsp, zone"
                />
              </label>
              <label className={styles.fieldStack}>
                <span className={styles.eyebrow}>Depth {filters.maxDepth}</span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={filters.maxDepth}
                  onChange={(event) => setFilters((current) => ({ ...current, maxDepth: Number.parseInt(event.target.value, 10) }))}
                />
              </label>
              <fieldset>
                <legend className={styles.eyebrow}>Edge Types</legend>
                <div className={styles.stackList}>
                  {EDGE_TYPES.map((edgeType) => (
                    <label key={edgeType} className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={filters.edgeTypes.includes(edgeType)}
                        onChange={() => toggleEdgeType(edgeType)}
                      />
                      <span>{edgeType}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.sharedNodesOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, sharedNodesOnly: event.target.checked }))}
                />
                <span>Shared node only</span>
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.entrySpecificOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, entrySpecificOnly: event.target.checked }))}
                />
                <span>Entry specific only</span>
              </label>
              <label className={styles.checkRow}>
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

        <section className={styles.graphPanel}>
          <header className={styles.graphPanelHead}>
            <div className={styles.graphTitle}>
              <p className={styles.eyebrow}>Selected Entry</p>
              <h2 className={styles.graphTitleHeading}>{selectedEntry?.label ?? "No entry selected"}</h2>
              <p className={cx(styles.mutedText, styles.monoText, styles.ellipsisText)} title={selectedEntry?.path}>
                {selectedEntry?.path}
              </p>
            </div>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>Depth {filters.maxDepth}</span>
              <span className={styles.badge}>{loading ? "Refreshing" : graph.stats.cacheHit ? "Cache Hit" : "Live"}</span>
            </div>
          </header>
          <div className={styles.graphStage}>
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

        <aside className={styles.rightPanel}>
          <div className={styles.detailBlock}>
            <p className={styles.eyebrow}>Selection</p>
            {zoneDetail ?? selectedGraphZone ? (
              <ZoneDetailView detail={zoneDetail ?? selectedGraphZone!} />
            ) : nodeDetail ?? selectedGraphNode ? (
              <NodeDetailView detail={nodeDetail} fallbackNode={selectedGraphNode} />
            ) : (
              <EmptyDetail selectedEntry={selectedEntry} />
            )}
          </div>
          <div className={styles.detailBlock}>
            <p className={styles.eyebrow}>Policy Trace</p>
            <ul className={styles.detailList}>
              {(zoneDetail?.traces ?? selectedGraphZone?.traces ?? graph.policyTrace.slice(0, 8)).map((trace) => (
                <li key={`${trace.policyId}:${trace.ruleId}`} className={styles.detailListItem}>
                  <strong>{trace.policyName}</strong>
                  <span>{trace.ruleName}</span>
                  <em>{trace.action}</em>
                </li>
              ))}
            </ul>
          </div>
          {statusMessage ? <div className={styles.statusBanner}>{statusMessage}</div> : null}
        </aside>
      </section>

      <footer className={styles.statusBar}>
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
    <div className={styles.matrixView}>
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
    return <div className={styles.emptyState}>Select an entry to calculate impact.</div>;
  }
  return (
    <div className={styles.impactGrid}>
      <article className={styles.impactCard}>
        <strong>Forward Impact</strong>
        <span>{graph.impact.forwardCount} nodes</span>
        <p>{graph.impact.forwardNodes.join(", ") || "-"}</p>
      </article>
      <article className={styles.impactCard}>
        <strong>Reverse Impact</strong>
        <span>{graph.impact.reverseCount} nodes</span>
        <p>{graph.impact.reverseNodes.join(", ") || "-"}</p>
      </article>
    </div>
  );
}

function CycleView({ graph }: { graph: DashboardVisibleGraphResponse }) {
  if (graph.cycles.length === 0) {
    return <div className={styles.emptyState}>No cycle detected in the visible graph.</div>;
  }
  return (
    <div className={styles.cycleList}>
      {graph.cycles.map((cycle) => (
        <article key={cycle.id} className={styles.cycleCard}>
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
    <div className={styles.detailStack}>
      <h3 className={styles.detailPanelTitle}>{node.label}</h3>
      <p className={cx(styles.mutedText, styles.monoText, styles.wrapText)}>{node.path ?? node.id}</p>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>{node.nodeType}</span>
        <span className={styles.badge}>in {node.incomingCount}</span>
        <span className={styles.badge}>out {node.outgoingCount}</span>
      </div>
      {detail ? (
        <>
          <p className={styles.eyebrow}>Representative References</p>
          <ul className={styles.detailList}>
            {detail.representativeReferences.length > 0 ? (
              detail.representativeReferences.map((reference, index) => (
                <li key={`${reference.source}:${reference.target}:${index}`} className={styles.detailListItem}>
                  <strong>{reference.methodName ?? reference.classPath ?? reference.target}</strong>
                  <span>{reference.snippet ?? reference.target}</span>
                  <em>
                    {reference.location?.line ? `L${reference.location.line}:${reference.location.column ?? 1}` : "n/a"}
                  </em>
                </li>
              ))
            ) : (
              <li className={styles.detailListItem}>No callsite metadata for the current node.</li>
            )}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ZoneDetailView({ detail }: { detail: DashboardZoneSummary }) {
  return (
    <div className={styles.detailStack}>
      <h3 className={styles.detailPanelTitle}>{detail.label}</h3>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>{detail.action}</span>
        <span className={styles.badge}>classes {detail.classCount}</span>
        <span className={styles.badge}>methods {detail.methodCount}</span>
      </div>
      <p className={styles.mutedText}>entry coverage {(detail.entryCoverage * 100).toFixed(0)}%</p>
      <p className={styles.eyebrow}>Top Classes</p>
      <ul className={styles.detailList}>
        {detail.topClasses.length > 0 ? detail.topClasses.map((entry) => <li key={entry} className={styles.detailListItem}>{entry}</li>) : <li className={styles.detailListItem}>No representative classes.</li>}
      </ul>
      <p className={styles.eyebrow}>Representative Path</p>
      <p className={cx(styles.mutedText, styles.monoText, styles.wrapText)}>{detail.representativePath.join(" → ") || "No path"}</p>
      <p className={styles.eyebrow}>Edge Breakdown</p>
      <ul className={styles.detailList}>
        {Object.entries(detail.edgeBreakdown).map(([edgeType, count]) => (
          <li key={edgeType} className={styles.detailListItem}>{edgeType}: {count}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyDetail({ selectedEntry }: { selectedEntry: DashboardEntry | undefined }) {
  return (
    <div className={styles.detailStack}>
      <h3 className={styles.detailPanelTitle}>{selectedEntry?.label ?? "No Selection"}</h3>
      <p className={cx(styles.mutedText, styles.monoText, styles.wrapText)}>{selectedEntry?.path ?? "Choose an entry or graph node."}</p>
      <p className={styles.mutedText}>Use the graph canvas, entries list, or zone cards to inspect the current visible graph.</p>
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
