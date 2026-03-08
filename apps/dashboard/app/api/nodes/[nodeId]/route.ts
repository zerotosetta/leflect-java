import { NextResponse } from "next/server";

import { getNodeDetail } from "@leflect-java/dashboard-data";

import { loadDashboardSnapshotFromEnv } from "@/lib/server-context";

export async function GET(
  _request: Request,
  context: { params: Promise<{ nodeId: string }> }
): Promise<Response> {
  const { nodeId } = await context.params;
  const snapshot = await loadDashboardSnapshotFromEnv();
  const detail = getNodeDetail(snapshot, decodeURIComponent(nodeId));
  if (!detail) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
