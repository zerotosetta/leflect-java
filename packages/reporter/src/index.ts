import fs from "fs/promises";
import path from "path";

import {
  ClassLabel,
  DiagnosticPathGroup,
  DiagnosticRecord,
  GraphEdge,
  JspImpactQueryResult,
  JspLabel,
  JavaUsagesQueryResult,
  LabelsIndex,
  MethodLabel,
  SummaryReport,
  TagUsagesQueryResult,
  UnresolvedReport
} from "@lefectjava/schema";

const CLASS_LABELS: ClassLabel[] = [
  "SERVICE",
  "DAO",
  "CONTROLLER",
  "TAG_HANDLER",
  "UTIL",
  "DTO",
  "UNKNOWN"
];

const METHOD_LABELS: MethodLabel[] = [
  "SERVICE_METHOD",
  "TAG_ENTRYPOINT",
  "ACCESSOR",
  "UNKNOWN"
];

const JSP_LABELS: JspLabel[] = ["PAGE", "FRAGMENT", "AJAX_VIEW", "UNKNOWN"];

export type ReporterClassRecord = {
  id: string;
  name: string;
  file?: string;
};

export type ReporterMethodRecord = {
  id: string;
  name: string;
  classId?: string;
};

export type ReporterJspRecord = {
  path: string;
};

export type ReporterTaglibRecord = {
  uri?: string;
  tags?: Array<{
    name?: string;
    tagClass?: string;
  }>;
};

export type ReporterReverseIndex = {
  handlerToJsp: Record<string, string[]>;
};

export type ReporterInput = {
  classes: ReporterClassRecord[];
  methods: ReporterMethodRecord[];
  jsps: ReporterJspRecord[];
  taglibs: ReporterTaglibRecord[];
  reverseIndex: ReporterReverseIndex;
  javaCallEdges: GraphEdge[];
  jspJavaEdges: GraphEdge[];
  diagnostics: DiagnosticRecord[];
  labels?: LabelsIndex;
};

export type ReporterArtifacts = {
  summary: SummaryReport;
  unresolved: UnresolvedReport;
  impactMarkdown: string;
};

export async function readReporterInput(
  analysisOut: string,
  labelsOut?: string
): Promise<ReporterInput> {
  const indexDir = path.join(analysisOut, "index");
  const graphDir = path.join(analysisOut, "graph");

  return {
    classes: await readJsonFile<ReporterClassRecord[]>(path.join(indexDir, "classes.json"), []),
    methods: await readJsonFile<ReporterMethodRecord[]>(path.join(indexDir, "methods.json"), []),
    jsps: await readJsonFile<ReporterJspRecord[]>(path.join(indexDir, "jsp-docs.json"), []),
    taglibs: await readJsonFile<ReporterTaglibRecord[]>(path.join(indexDir, "taglibs.json"), []),
    reverseIndex: await readJsonFile<ReporterReverseIndex>(
      path.join(indexDir, "reverse-index.json"),
      { handlerToJsp: {} }
    ),
    javaCallEdges: await readJsonlFile(path.join(graphDir, "java-call.jsonl")),
    jspJavaEdges: await readJsonlFile(path.join(graphDir, "jsp-java.jsonl")),
    diagnostics: [
      ...await readDiagnosticJsonlFile(path.join(analysisOut, "logs", "java-parse-errors.jsonl"), "java-parse"),
      ...await readDiagnosticJsonlFile(path.join(analysisOut, "logs", "jsp-parse-errors.jsonl"), "jsp-parse")
    ],
    labels: labelsOut
      ? await readOptionalJsonFile<LabelsIndex>(labelsOut)
      : await readOptionalJsonFile<LabelsIndex>(path.join(indexDir, "labels.json"))
  };
}

export function buildReports(input: ReporterInput): ReporterArtifacts {
  return {
    summary: buildSummaryReport(input),
    unresolved: buildUnresolvedReport(input),
    impactMarkdown: buildImpactMarkdown(input)
  };
}

export async function writeReports(
  analysisOut: string,
  reports: ReporterArtifacts
): Promise<void> {
  const reportDir = path.join(analysisOut, "report");
  await fs.mkdir(reportDir, { recursive: true });

  await fs.writeFile(
    path.join(reportDir, "summary.json"),
    JSON.stringify(reports.summary, null, 2)
  );
  await fs.writeFile(
    path.join(reportDir, "unresolved.json"),
    JSON.stringify(reports.unresolved, null, 2)
  );
  await fs.writeFile(path.join(reportDir, "impact.md"), reports.impactMarkdown);
}

export function buildSummaryReport(input: ReporterInput): SummaryReport {
  const generatedAt = new Date().toISOString();
  const unresolvedEdges = collectUnresolvedEdges(input);

  return {
    schemaVersion: "1.0",
    generatedAt,
    counts: {
      classes: input.classes.length,
      methods: input.methods.length,
      jsps: input.jsps.length,
      taglibs: input.taglibs.length,
      javaCallEdges: input.javaCallEdges.length,
      jspJavaEdges: input.jspJavaEdges.length,
      unresolvedEdges: unresolvedEdges.length
    },
    labels: {
      classes: countLabels(CLASS_LABELS, Object.values(input.labels?.classes ?? {})),
      methods: countLabels(METHOD_LABELS, Object.values(input.labels?.methods ?? {})),
      jsps: countLabels(JSP_LABELS, Object.values(input.labels?.jsps ?? {}))
    },
    jspImpacts: buildJspImpacts(input)
  };
}

export function buildUnresolvedReport(input: ReporterInput): UnresolvedReport {
  const diagnostics = buildDetailedDiagnostics(input);
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    edges: collectUnresolvedEdges(input),
    diagnostics,
    byPath: groupDiagnosticsByPath(diagnostics)
  };
}

export function buildImpactMarkdown(input: ReporterInput): string {
  const summary = buildSummaryReport(input);
  const sections: string[] = [
    "# LeflectJava Impact Report",
    "",
    "## Summary",
    `- Classes: ${summary.counts.classes}`,
    `- Methods: ${summary.counts.methods}`,
    `- JSPs: ${summary.counts.jsps}`,
    `- Taglibs: ${summary.counts.taglibs}`,
    `- Java call edges: ${summary.counts.javaCallEdges}`,
    `- JSP/Java edges: ${summary.counts.jspJavaEdges}`,
    `- Unresolved edges: ${summary.counts.unresolvedEdges}`,
    "",
    "## JSP Impact"
  ];

  if (summary.jspImpacts.length === 0) {
    sections.push("- No JSP impact entries.");
  } else {
    for (const impact of summary.jspImpacts) {
      sections.push(`### ${impact.jspPath}`);
      sections.push(
        `- Labels: ${impact.labels.length > 0 ? impact.labels.join(", ") : "UNKNOWN"}`
      );
      sections.push(
        `- Java targets: ${impact.javaTargets.length > 0 ? impact.javaTargets.join(", ") : "-"}` 
      );
      sections.push(
        `- Tag handlers: ${impact.tagHandlers.length > 0 ? impact.tagHandlers.join(", ") : "-"}`
      );
      sections.push(
        `- Unresolved: ${
          impact.unresolvedTargets.length > 0 ? impact.unresolvedTargets.join(", ") : "-"
        }`
      );
      sections.push("");
    }
  }

  sections.push("## Java Usages");

  const classEntries = [...input.classes].sort((left, right) => left.id.localeCompare(right.id));
  if (classEntries.length === 0) {
    sections.push("- No indexed Java classes.");
  } else {
    for (const entry of classEntries) {
      const usage = queryJavaUsages(input, entry.id);
      sections.push(`### ${usage.classId}`);
      sections.push(
        `- Java callers: ${usage.javaCallers.length > 0 ? usage.javaCallers.join(", ") : "-"}`
      );
      sections.push(
        `- JSP callers: ${usage.jspCallers.length > 0 ? usage.jspCallers.join(", ") : "-"}`
      );
      sections.push(
        `- Tag usages: ${usage.tagUsageJsp.length > 0 ? usage.tagUsageJsp.join(", ") : "-"}`
      );
      sections.push("");
    }
  }

  return `${sections.join("\n").trimEnd()}\n`;
}

export function queryJspImpact(
  input: ReporterInput,
  file: string
): JspImpactQueryResult {
  const normalizedFile = normalizePath(file);
  const edges = input.jspJavaEdges.filter((edge) => normalizePath(edge.from) === normalizedFile);

  return {
    file: normalizedFile,
    labels: input.labels?.jsps[normalizedFile] ?? [],
    javaTargets: collectUnique(
      edges
        .filter((edge) => edge.type === "JSP_SCRIPTLET_CALL" && edge.confidence !== "unresolved")
        .map((edge) => edge.to)
    ),
    tagHandlers: collectUnique(
      edges
        .filter((edge) => edge.type === "JSP_USES_TAG" && edge.confidence !== "unresolved")
        .map((edge) => edge.to)
    ),
    unresolvedTargets: collectUnique(
      edges
        .filter((edge) => edge.confidence === "unresolved")
        .map((edge) => edge.to)
    ),
    edges
  };
}

export function queryJavaUsages(
  input: ReporterInput,
  className: string
): JavaUsagesQueryResult {
  const resolvedClass = resolveClassRecord(input.classes, className);
  const classId = resolvedClass?.id ?? className;

  return {
    classId,
    className: resolvedClass?.name,
    labels: input.labels?.classes[classId] ?? [],
    javaCallers: collectUnique(
      input.javaCallEdges
        .filter((edge) => edge.to === classId)
        .map((edge) => edge.from)
    ),
    jspCallers: collectUnique(
      input.jspJavaEdges
        .filter((edge) => edge.type === "JSP_SCRIPTLET_CALL" && edge.to === classId)
        .map((edge) => edge.from)
    ),
    tagUsageJsp: collectUnique(input.reverseIndex.handlerToJsp[classId] ?? [])
  };
}

export function queryTagUsages(
  input: ReporterInput,
  className: string
): TagUsagesQueryResult {
  const resolvedClass = resolveClassRecord(input.classes, className);
  const classId = resolvedClass?.id ?? className;

  return {
    classId,
    className: resolvedClass?.name,
    labels: input.labels?.classes[classId] ?? [],
    jspFiles: collectUnique([
      ...(input.reverseIndex.handlerToJsp[classId] ?? []),
      ...input.jspJavaEdges
        .filter((edge) => edge.type === "JSP_USES_TAG" && edge.to === classId)
        .map((edge) => edge.from)
    ])
  };
}

export function formatJspImpactResult(result: JspImpactQueryResult): string {
  return [
    `JSP: ${result.file}`,
    `Labels: ${formatList(result.labels)}`,
    `Java targets: ${formatList(result.javaTargets)}`,
    `Tag handlers: ${formatList(result.tagHandlers)}`,
    `Unresolved: ${formatList(result.unresolvedTargets)}`
  ].join("\n");
}

export function formatJavaUsagesResult(result: JavaUsagesQueryResult): string {
  return [
    `Class: ${result.classId}`,
    `Labels: ${formatList(result.labels)}`,
    `Java callers: ${formatList(result.javaCallers)}`,
    `JSP callers: ${formatList(result.jspCallers)}`,
    `Tag usages: ${formatList(result.tagUsageJsp)}`
  ].join("\n");
}

export function formatTagUsagesResult(result: TagUsagesQueryResult): string {
  return [
    `Tag handler: ${result.classId}`,
    `Labels: ${formatList(result.labels)}`,
    `JSP files: ${formatList(result.jspFiles)}`
  ].join("\n");
}

function buildJspImpacts(
  input: ReporterInput
): SummaryReport["jspImpacts"] {
  return input.jsps
    .map((entry) => queryJspImpact(input, entry.path))
    .filter(
      (entry) =>
        entry.javaTargets.length > 0 ||
        entry.tagHandlers.length > 0 ||
        entry.unresolvedTargets.length > 0
    )
    .sort((left, right) => {
      const leftSize =
        left.javaTargets.length + left.tagHandlers.length + left.unresolvedTargets.length;
      const rightSize =
        right.javaTargets.length + right.tagHandlers.length + right.unresolvedTargets.length;
      return rightSize - leftSize || left.file.localeCompare(right.file);
    })
    .map((entry) => ({
      jspPath: entry.file,
      labels: entry.labels,
      javaTargets: entry.javaTargets,
      tagHandlers: entry.tagHandlers,
      unresolvedTargets: entry.unresolvedTargets
    }));
}

function collectUnresolvedEdges(input: ReporterInput): GraphEdge[] {
  return [...input.javaCallEdges, ...input.jspJavaEdges].filter(
    (edge) => edge.confidence === "unresolved"
  );
}

function buildDetailedDiagnostics(input: ReporterInput): DiagnosticRecord[] {
  return [...input.diagnostics, ...collectUnresolvedEdges(input).map(toDiagnosticFromEdge)].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.stage.localeCompare(right.stage) ||
      left.category.localeCompare(right.category)
  );
}

function groupDiagnosticsByPath(diagnostics: DiagnosticRecord[]): DiagnosticPathGroup[] {
  const groups = new Map<string, DiagnosticRecord[]>();
  for (const diagnostic of diagnostics) {
    const key = normalizePath(diagnostic.path);
    const entries = groups.get(key) ?? [];
    entries.push(diagnostic);
    groups.set(key, entries);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([pathKey, entries]) => ({
      path: pathKey,
      diagnostics: entries
    }));
}

function toDiagnosticFromEdge(edge: GraphEdge): DiagnosticRecord {
  const parsed = parseUnresolvedTarget(edge.to);
  const base: DiagnosticRecord = {
    stage: "graph",
    severity: "warning",
    path: normalizePath(edge.from),
    category: "graph.unresolved",
    summary: "Unresolved graph edge",
    message: `Unresolved edge from ${edge.from} to ${edge.to}`,
    detail: `type=${edge.type}, confidence=${edge.confidence}`,
    hint: "Inspect the source metadata and supporting indexes for missing type or taglib resolution."
  };

  if (!parsed) {
    return base;
  }

  if (parsed.kind === "tag") {
    return {
      ...base,
      category: "jsp.tag.unresolved",
      summary: `Tag ${parsed.symbol} could not be resolved`,
      message: `No handler class was resolved for tag ${parsed.symbol}.`,
      symbol: parsed.symbol,
      hint: "Provide the matching TLD or dependency JAR so the taglib can be resolved."
    };
  }

  if (parsed.kind === "scriptlet") {
    return {
      ...base,
      category: "jsp.scriptlet.target.unresolved",
      summary: "Scriptlet target could not be resolved",
      message: "A JSP scriptlet produced an unresolved Java target.",
      hint: "Inspect the scriptlet code and Java index inputs for missing classes or ambiguous references."
    };
  }

  if (parsed.kind === "java-call") {
    return {
      ...base,
      category: "java.call.unresolved",
      summary: "Java call graph target could not be resolved",
      message: "A Java call edge remained unresolved in the graph.",
      hint: "Inspect the parsed Java summary and call extraction for missing type information."
    };
  }

  return base;
}

function parseUnresolvedTarget(
  value: string
): { kind: "tag" | "scriptlet" | "java-call"; symbol?: string } | undefined {
  const normalized = normalizePath(value);

  const tagMatch = normalized.match(/^unresolved:tag:([^:]+):([^:]+)(?::\d+)?$/);
  if (tagMatch) {
    return { kind: "tag", symbol: `${tagMatch[1]}:${tagMatch[2]}` };
  }

  if (normalized.startsWith("unresolved:scriptlet:")) {
    return { kind: "scriptlet" };
  }

  if (normalized.startsWith("unresolved:java-call:")) {
    return { kind: "java-call" };
  }

  return undefined;
}

function countLabels<TLabel extends string>(
  knownLabels: TLabel[],
  values: TLabel[][]
): Record<TLabel, number> {
  const counts = Object.fromEntries(knownLabels.map((label) => [label, 0])) as Record<
    TLabel,
    number
  >;

  for (const labels of values) {
    for (const label of labels) {
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }

  return counts;
}

function resolveClassRecord(
  classes: ReporterClassRecord[],
  className: string
): ReporterClassRecord | undefined {
  return classes.find((entry) => entry.id === className) ??
    classes.find((entry) => entry.name === className) ??
    classes.find((entry) => entry.id.endsWith(`.${className}`));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function collectUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizePath(value)))).sort();
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readJsonlFile(filePath: string): Promise<GraphEdge[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as GraphEdge);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readDiagnosticJsonlFile(
  filePath: string,
  stage: "java-parse" | "jsp-parse"
): Promise<DiagnosticRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => normalizeDiagnosticRecord(JSON.parse(line) as Record<string, unknown>, stage));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizeDiagnosticRecord(
  payload: Record<string, unknown>,
  stage: "java-parse" | "jsp-parse"
): DiagnosticRecord {
  const location =
    payload["location"] && typeof payload["location"] === "object"
      ? normalizeLocation(payload["location"] as Record<string, unknown>)
      : undefined;
  const message = asString(payload["message"]) ?? "";
  const category = asString(payload["category"]) ?? defaultCategory(stage, message);

  return {
    stage: asString(payload["stage"]) ?? stage,
    severity: asSeverity(payload["severity"]) ?? "error",
    path: normalizePath(asString(payload["path"]) ?? ""),
    category,
    summary: asString(payload["summary"]) ?? defaultSummary(stage, category, message),
    message,
    detail: asString(payload["detail"]),
    hint: asString(payload["hint"]) ?? defaultHint(stage, category),
    relatedUri: asString(payload["relatedUri"]),
    symbol: asString(payload["symbol"]),
    generatedPath: normalizeOptionalPath(asString(payload["generatedPath"]) ?? asString(payload["generatedServletPath"])),
    snippet: asString(payload["snippet"]),
    rawCause: asString(payload["rawCause"]),
    location
  };
}

function normalizeLocation(payload: Record<string, unknown>): DiagnosticRecord["location"] {
  return {
    line: asNumber(payload["line"]),
    column: asNumber(payload["column"]),
    endLine: asNumber(payload["endLine"]),
    endColumn: asNumber(payload["endColumn"])
  };
}

function defaultCategory(stage: "java-parse" | "jsp-parse", message: string): string {
  if (
    stage === "jsp-parse" &&
    /absolute uri:\s*\[.+?\]\s*cannot be resolved/i.test(message)
  ) {
    return "jsp.taglib.uri.unresolved";
  }
  return stage === "java-parse" ? "java.parse.problem" : "jsp.compile.error";
}

function defaultSummary(
  stage: "java-parse" | "jsp-parse",
  category: string,
  message: string
): string {
  if (category === "jsp.taglib.uri.unresolved") {
    return "Taglib URI could not be resolved";
  }
  if (stage === "java-parse") {
    return "Java parse problem";
  }
  return message ? "JSP compilation failed" : "JSP parse problem";
}

function defaultHint(stage: "java-parse" | "jsp-parse", category: string): string | undefined {
  if (category === "jsp.taglib.uri.unresolved") {
    return "Add the dependency JAR/TLD for this URI or declare the mapping in web.xml.";
  }
  if (stage === "java-parse") {
    return "Inspect the Java source near the reported location.";
  }
  if (stage === "jsp-parse") {
    return "Inspect the JSP and required taglib dependencies.";
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asSeverity(value: unknown): "error" | "warning" | undefined {
  return value === "error" || value === "warning" ? value : undefined;
}

function normalizeOptionalPath(value?: string): string | undefined {
  return value ? normalizePath(value) : undefined;
}
