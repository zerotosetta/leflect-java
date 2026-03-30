import { describe, expect, it } from "vitest";

import { buildVisibleGraphWithPolicies } from "../graph";
import { createDefaultPolicies } from "../policies";
import { LoadedDashboardSnapshot } from "../snapshot";

const snapshot: LoadedDashboardSnapshot = {
  context: {
    root: "/tmp/project",
    analysisOut: "/tmp/project/analysis",
    projectName: "project"
  },
  generatedAt: new Date().toISOString(),
  summary: {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    counts: {
      classes: 2,
      methods: 0,
      jsps: 1,
      taglibs: 0,
      javaCallEdges: 2,
      jspJavaEdges: 0,
      unresolvedEdges: 0
    },
    labels: {
      classes: {
        SERVICE: 0,
        DAO: 0,
        CONTROLLER: 1,
        TAG_HANDLER: 0,
        UTIL: 0,
        DTO: 0,
        UNKNOWN: 1
      },
      methods: {
        SERVICE_METHOD: 0,
        TAG_ENTRYPOINT: 0,
        ACCESSOR: 0,
        UNKNOWN: 0
      },
      jsps: {
        PAGE: 1,
        FRAGMENT: 0,
        AJAX_VIEW: 0,
        UNKNOWN: 0
      }
    },
    jspImpacts: []
  },
  unresolved: {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    edges: [],
    diagnostics: [],
    byPath: [],
    byCause: []
  },
  labels: undefined,
  classes: [],
  methods: [],
  jsps: [],
  fileDependencyIndex: {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    files: []
  },
  entryDependencyIndex: {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    patterns: { java: [], jsp: [] },
    matchedEntries: [],
    unmatchedPatterns: [],
    entries: []
  },
  fileEdges: [
    {
      from: "src/main/webapp/WEB-INF/jsp/index.jsp",
      to: "src/main/java/demo/web/HomeController.java",
      type: "JSP_SCRIPTLET_CALL",
      confidence: "high"
    },
    {
      from: "src/main/java/demo/web/HomeController.java",
      to: "java.lang.String",
      type: "JAVA_CALL",
      confidence: "high"
    }
  ],
  javaMethodCalls: [],
  jspMethodCalls: [],
  entries: [
    {
      id: "src/main/webapp/WEB-INF/jsp/index.jsp",
      type: "jsp",
      label: "index.jsp",
      path: "src/main/webapp/WEB-INF/jsp/index.jsp",
      matchedBy: []
    }
  ],
  defaultEntryId: "src/main/webapp/WEB-INF/jsp/index.jsp",
  nodes: [
    {
      id: "src/main/webapp/WEB-INF/jsp/index.jsp",
      label: "index.jsp",
      kind: "file",
      nodeType: "jsp",
      path: "src/main/webapp/WEB-INF/jsp/index.jsp",
      zoneId: "jsp:index",
      zoneLabel: "jsp:index",
      classId: undefined,
      packageName: undefined,
      labels: [],
      isEntry: false,
      incomingCount: 0,
      outgoingCount: 1,
      collapsed: false,
      summarized: false,
      hidden: false,
      references: [],
      referencedBy: [],
      representativeClasses: [],
      matchKeys: ["jsp:index"],
      action: undefined
    },
    {
      id: "src/main/java/demo/web/HomeController.java",
      label: "HomeController",
      kind: "file",
      nodeType: "java",
      path: "src/main/java/demo/web/HomeController.java",
      zoneId: "pkg:demo.web",
      zoneLabel: "demo.web.*",
      classId: "demo.web.HomeController",
      packageName: "demo.web",
      labels: ["CONTROLLER"],
      isEntry: false,
      incomingCount: 1,
      outgoingCount: 1,
      collapsed: false,
      summarized: false,
      hidden: false,
      references: [],
      referencedBy: [],
      representativeClasses: ["HomeController"],
      matchKeys: ["demo.web.*"],
      action: undefined
    },
    {
      id: "java.lang.String",
      label: "String",
      kind: "external",
      nodeType: "unresolved",
      path: "java.lang.String",
      zoneId: "ext:java",
      zoneLabel: "java.*",
      classId: "java.lang.String",
      packageName: "java.lang",
      labels: [],
      isEntry: false,
      incomingCount: 1,
      outgoingCount: 0,
      collapsed: false,
      summarized: false,
      hidden: false,
      references: [],
      referencedBy: [],
      representativeClasses: ["java.lang.String"],
      matchKeys: ["java.*", "java.lang.String"],
      action: undefined
    }
  ],
  zones: [
    {
      id: "jsp:index",
      label: "jsp:index",
      nodeKinds: ["jsp"],
      nodeCount: 1,
      packageCount: 0,
      classCount: 0,
      methodCount: 0,
      entryCoverage: 1,
      fanIn: 0,
      fanOut: 1,
      topClasses: [],
      edgeBreakdown: { JSP_SCRIPTLET_CALL: 1 },
      representativePath: ["src/main/webapp/WEB-INF/jsp/index.jsp"],
      action: "EXPAND",
      traces: [],
      hiddenNodeCount: 0,
      visibleNodeCount: 1,
      matchKeys: ["jsp:index"],
      nodeIds: ["src/main/webapp/WEB-INF/jsp/index.jsp"],
      rawEdgeCount: 1,
      reachableEntries: ["src/main/webapp/WEB-INF/jsp/index.jsp"]
    },
    {
      id: "pkg:demo.web",
      label: "demo.web.*",
      nodeKinds: ["java"],
      nodeCount: 1,
      packageCount: 1,
      classCount: 1,
      methodCount: 0,
      entryCoverage: 1,
      fanIn: 1,
      fanOut: 1,
      topClasses: ["HomeController"],
      edgeBreakdown: { JAVA_CALL: 1 },
      representativePath: [
        "src/main/webapp/WEB-INF/jsp/index.jsp",
        "src/main/java/demo/web/HomeController.java"
      ],
      action: "EXPAND",
      traces: [],
      hiddenNodeCount: 0,
      visibleNodeCount: 1,
      matchKeys: ["demo.web.*"],
      nodeIds: ["src/main/java/demo/web/HomeController.java"],
      rawEdgeCount: 1,
      reachableEntries: ["src/main/webapp/WEB-INF/jsp/index.jsp"]
    },
    {
      id: "ext:java",
      label: "java.*",
      nodeKinds: ["unresolved"],
      nodeCount: 1,
      packageCount: 1,
      classCount: 1,
      methodCount: 0,
      entryCoverage: 1,
      fanIn: 1,
      fanOut: 0,
      topClasses: ["java.lang.String"],
      edgeBreakdown: { JAVA_CALL: 1 },
      representativePath: [
        "src/main/webapp/WEB-INF/jsp/index.jsp",
        "src/main/java/demo/web/HomeController.java",
        "java.lang.String"
      ],
      action: "EXPAND",
      traces: [],
      hiddenNodeCount: 0,
      visibleNodeCount: 1,
      matchKeys: ["java.*", "java.lang.String"],
      nodeIds: ["java.lang.String"],
      rawEdgeCount: 0,
      reachableEntries: ["src/main/webapp/WEB-INF/jsp/index.jsp"]
    }
  ],
  nodesById: new Map(),
  zonesById: new Map(),
  adjacency: new Map(),
  reverseAdjacency: new Map()
};

snapshot.nodesById = new Map(snapshot.nodes.map((entry) => [entry.id, entry]));
snapshot.zonesById = new Map(snapshot.zones.map((entry) => [entry.id, entry]));
snapshot.adjacency = new Map([
  ["src/main/webapp/WEB-INF/jsp/index.jsp", [snapshot.fileEdges[0]]],
  ["src/main/java/demo/web/HomeController.java", [snapshot.fileEdges[1]]]
]);
snapshot.reverseAdjacency = new Map([
  ["src/main/java/demo/web/HomeController.java", [snapshot.fileEdges[0]]],
  ["java.lang.String", [snapshot.fileEdges[1]]]
]);

describe("buildVisibleGraphWithPolicies", () => {
  it("hides standard library nodes and keeps entry visible", () => {
    const policies = createDefaultPolicies();
    const result = buildVisibleGraphWithPolicies(snapshot, policies, {
      entryId: "src/main/webapp/WEB-INF/jsp/index.jsp",
      filters: { maxDepth: 4 }
    });

    expect(result.nodes.some((entry) => entry.id === "src/main/webapp/WEB-INF/jsp/index.jsp")).toBe(true);
    expect(result.nodes.some((entry) => entry.id === "src/main/java/demo/web/HomeController.java")).toBe(true);
    expect(result.nodes.some((entry) => entry.id === "java.lang.String")).toBe(false);
    expect(result.stats.hiddenNodeCount).toBe(1);
  });
});
