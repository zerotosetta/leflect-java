import { NextRequest, NextResponse } from "next/server";

import { loadDashboardBootstrapFromEnv } from "@/lib/server-context";

export async function GET(request: NextRequest): Promise<Response> {
  const bootstrap = await loadDashboardBootstrapFromEnv();
  const type = request.nextUrl.searchParams.get("type")?.trim();
  const query = request.nextUrl.searchParams.get("query")?.trim().toLowerCase();
  const entries = bootstrap.entries.filter((entry) => {
    if (type && entry.type !== type) {
      return false;
    }
    if (query) {
      return [entry.label, entry.path, entry.classId, entry.packageName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    }
    return true;
  });
  return NextResponse.json({ entries });
}
