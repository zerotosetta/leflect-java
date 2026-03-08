import { NextRequest, NextResponse } from "next/server";

import { buildVisibleGraph } from "@leflect-java/dashboard-data";

import { loadDashboardSnapshotFromEnv } from "@/lib/server-context";

export async function POST(request: NextRequest): Promise<Response> {
  const snapshot = await loadDashboardSnapshotFromEnv();
  const body = (await request.json().catch(() => ({}))) as {
    entryId?: string;
    zoneId?: string;
    activePolicyIds?: string[];
    filters?: Record<string, unknown>;
    manualOverrides?: Array<{ zoneId: string; action: "EXPAND" | "COLLAPSE" | "SUMMARIZE" | "HIDE" }>;
  };
  if (!body.zoneId) {
    return NextResponse.json({ error: "Request body must include zoneId" }, { status: 400 });
  }
  const manualOverrides = [
    ...(body.manualOverrides ?? []).filter((entry) => entry.zoneId !== body.zoneId),
    { zoneId: body.zoneId, action: "EXPAND" as const }
  ];
  const graph = await buildVisibleGraph(snapshot, {
    entryId: body.entryId,
    activePolicyIds: body.activePolicyIds,
    filters: body.filters,
    manualOverrides
  });
  return NextResponse.json(graph);
}
