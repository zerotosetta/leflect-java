import { loadDashboardBootstrapFromEnv } from "@/lib/server-context";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const bootstrap = await loadDashboardBootstrapFromEnv();
  return <DashboardShell bootstrap={bootstrap} />;
}
