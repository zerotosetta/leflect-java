import { NextRequest, NextResponse } from "next/server";

import { buildVisibleGraph } from "@leflect-java/dashboard-data";

import { loadDashboardSnapshotFromEnv } from "@/lib/server-context";

export async function POST(request: NextRequest): Promise<Response> {
  const snapshot = await loadDashboardSnapshotFromEnv();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const graph = await buildVisibleGraph(snapshot, body);
  return NextResponse.json(graph);
}
