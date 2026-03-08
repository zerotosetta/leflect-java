import { NextRequest, NextResponse } from "next/server";

import { readPolicies, savePolicies } from "@leflect-java/dashboard-data";

import { readDashboardContextFromEnv } from "@/lib/server-context";

export async function GET(): Promise<Response> {
  const policies = await readPolicies(readDashboardContextFromEnv());
  return NextResponse.json({ policies });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as { policies?: unknown };
  if (!Array.isArray(body.policies)) {
    return NextResponse.json({ error: "Request body must include policies[]" }, { status: 400 });
  }
  const policies = await savePolicies(readDashboardContextFromEnv(), body.policies as never[]);
  return NextResponse.json({ policies });
}
