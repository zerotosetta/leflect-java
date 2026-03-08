import { NextResponse } from "next/server";

import { loadDashboardBootstrapFromEnv } from "@/lib/server-context";

export async function GET(): Promise<Response> {
  const bootstrap = await loadDashboardBootstrapFromEnv();
  return NextResponse.json(bootstrap);
}
