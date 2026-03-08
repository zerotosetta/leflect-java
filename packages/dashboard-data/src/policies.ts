import fs from "fs/promises";
import path from "path";

import { DashboardContext, DashboardPolicy, DashboardPolicyStore } from "./types";
import { readJsonFile } from "./util";

const SCHEMA_VERSION = "1.0";

export function dashboardArtifactsDir(analysisOut: string): string {
  return path.join(analysisOut, "dashboard");
}

export function dashboardPoliciesPath(analysisOut: string): string {
  return path.join(dashboardArtifactsDir(analysisOut), "policies.json");
}

export function createDefaultPolicies(): DashboardPolicy[] {
  const now = new Date().toISOString();
  return [
    {
      id: "legacy-default",
      name: "Legacy Default",
      enabled: true,
      priority: 100,
      scope: "PROJECT",
      conflictStrategy: "MOST_SPECIFIC_WINS",
      updatedAt: now,
      rules: [
        createRule(now, "legacy-expand-web", "Expand Web Layer", 500, ["**.web.**", "jsp:**"], "EXPAND"),
        createRule(now, "legacy-expand-service", "Expand Service Layer", 450, ["**.service.**"], "EXPAND"),
        createRule(now, "legacy-collapse-repository", "Collapse Repository Layer", 300, ["**.repository.**", "**.dao.**"], "COLLAPSE"),
        createRule(now, "legacy-summarize-model", "Summarize Model Layer", 200, ["**.model.**"], "SUMMARIZE")
      ]
    },
    {
      id: "flow-focus",
      name: "Loan Flow Focus",
      enabled: true,
      priority: 300,
      scope: "ENTRYPOINT",
      conflictStrategy: "MOST_SPECIFIC_WINS",
      updatedAt: now,
      scopeValue: "*",
      rules: [
        createRule(now, "focus-expand-entry", "Expand Entry Zone", 600, ["jsp:**", "**.web.**"], "EXPAND"),
        createRule(now, "focus-expand-domain-service", "Expand Domain Services", 550, ["**.service.**", "**.controller.**"], "EXPAND"),
        createRule(now, "focus-collapse-common", "Collapse Common Boundary", 250, ["**.common.**", "**.util.**", "**.repository.**"], "COLLAPSE"),
        createRule(now, "focus-summarize-framework", "Summarize Frameworks", 100, ["org.springframework.**", "org.apache.**"], "SUMMARIZE")
      ]
    },
    {
      id: "hide-stdlib",
      name: "Hide Standard Library",
      enabled: true,
      priority: 500,
      scope: "GLOBAL",
      conflictStrategy: "MOST_SPECIFIC_WINS",
      updatedAt: now,
      rules: [
        createRule(now, "hide-java", "Hide java.*", 900, ["java.**", "jdk.**"], "HIDE"),
        createRule(now, "hide-jakarta", "Hide javax/jakarta.*", 800, ["javax.**", "jakarta.**"], "HIDE"),
        createRule(now, "summarize-spring", "Summarize Spring", 400, ["org.springframework.**"], "SUMMARIZE")
      ]
    },
    {
      id: "full-debug",
      name: "Full Debug Mode",
      enabled: false,
      priority: 50,
      scope: "SESSION",
      conflictStrategy: "MOST_SPECIFIC_WINS",
      updatedAt: now,
      rules: [
        createRule(now, "debug-expand-all", "Expand Entire Graph", 1000, ["**"], "EXPAND")
      ]
    }
  ];
}

export async function readPolicies(context: DashboardContext): Promise<DashboardPolicy[]> {
  const filePath = dashboardPoliciesPath(context.analysisOut);
  const store = await readJsonFile<DashboardPolicyStore | undefined>(filePath, undefined);
  if (!store || !Array.isArray(store.policies) || store.policies.length === 0) {
    return createDefaultPolicies();
  }
  return store.policies;
}

export async function savePolicies(
  context: DashboardContext,
  policies: DashboardPolicy[]
): Promise<DashboardPolicy[]> {
  const outDir = dashboardArtifactsDir(context.analysisOut);
  await fs.mkdir(outDir, { recursive: true });
  const payload: DashboardPolicyStore = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    policies
  };
  await fs.writeFile(dashboardPoliciesPath(context.analysisOut), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return policies;
}

function createRule(
  timestamp: string,
  id: string,
  name: string,
  priority: number,
  zonePatterns: string[],
  action: DashboardPolicy["rules"][number]["action"]["type"]
): DashboardPolicy["rules"][number] {
  return {
    id,
    name,
    enabled: true,
    priority,
    updatedAt: timestamp,
    match: {
      zonePatterns
    },
    action: {
      type: action,
      aggregateEdges: true,
      keepTopKNodes: 3
    }
  };
}
