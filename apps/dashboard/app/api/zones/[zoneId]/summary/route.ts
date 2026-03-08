import { NextRequest, NextResponse } from "next/server";

import { getZoneSummary } from "@leflect-java/dashboard-data";

import { loadDashboardSnapshotFromEnv } from "@/lib/server-context";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ zoneId: string }> }
): Promise<Response> {
  const { zoneId } = await context.params;
  const snapshot = await loadDashboardSnapshotFromEnv();
  const activePolicyIds = request.nextUrl.searchParams.getAll("activePolicyId");
  const entryId = request.nextUrl.searchParams.get("entryId") ?? undefined;
  const maxDepth = request.nextUrl.searchParams.get("maxDepth");
  const edgeTypes = request.nextUrl.searchParams.getAll("edgeType");
  const summary = await getZoneSummary(snapshot, decodeURIComponent(zoneId), {
    entryId,
    activePolicyIds,
    filters: {
      maxDepth: maxDepth ? Number.parseInt(maxDepth, 10) : undefined,
      edgeTypes: edgeTypes.length > 0 ? (edgeTypes as never[]) : undefined
    }
  });
  if (!summary) {
    return NextResponse.json({ error: "Zone not found" }, { status: 404 });
  }
  return NextResponse.json(summary);
}
