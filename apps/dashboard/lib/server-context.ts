import {
  DashboardBootstrap,
  getDashboardBootstrap,
  loadDashboardSnapshot,
  LoadedDashboardSnapshot
} from "@leflect-java/dashboard-data";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing dashboard environment variable: ${name}`);
  }
  return value;
}

export function readDashboardContextFromEnv() {
  return {
    root: requiredEnv("LEFLECT_DASHBOARD_ROOT"),
    analysisOut: requiredEnv("LEFLECT_DASHBOARD_ANALYSIS_OUT"),
    configPath: process.env.LEFLECT_DASHBOARD_CONFIG_PATH,
    projectName: process.env.LEFLECT_DASHBOARD_PROJECT
  };
}

export async function loadDashboardBootstrapFromEnv(): Promise<DashboardBootstrap> {
  const snapshot = await loadDashboardSnapshot(readDashboardContextFromEnv());
  return getDashboardBootstrap(snapshot);
}

export async function loadDashboardSnapshotFromEnv(): Promise<LoadedDashboardSnapshot> {
  return loadDashboardSnapshot(readDashboardContextFromEnv());
}
