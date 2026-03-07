import fs from "fs/promises";
import path from "path";

import { ClassLabel, JspLabel, LabelsIndex, MethodLabel } from "@lefectjava/schema";

export type LabelerClassRecord = {
  id: string;
  name: string;
  file: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
};

export type LabelerMethodRecord = {
  id: string;
  name: string;
  classId?: string;
  visibility?: string;
};

export type LabelerJspRecord = {
  path: string;
};

export type LabelerInput = {
  classes: LabelerClassRecord[];
  methods: LabelerMethodRecord[];
  jsps: LabelerJspRecord[];
};

export function buildLabelsIndex(input: LabelerInput): LabelsIndex {
  const classes: LabelsIndex["classes"] = {};
  const methods: LabelsIndex["methods"] = {};
  const jsps: LabelsIndex["jsps"] = {};

  const classLabelMap = new Map<string, ClassLabel[]>();

  for (const entry of input.classes) {
    const labels = labelClass(entry);
    classes[entry.id] = labels;
    classLabelMap.set(entry.id, labels);
  }

  for (const entry of input.methods) {
    methods[entry.id] = labelMethod(entry, classLabelMap.get(entry.classId ?? "") ?? []);
  }

  for (const entry of input.jsps) {
    jsps[entry.path] = labelJsp(entry);
  }

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    classes,
    methods,
    jsps
  };
}

export async function writeLabelsIndex(outputPath: string, index: LabelsIndex): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(index, null, 2));
}

export async function readLabelsIndex(outputPath: string): Promise<LabelsIndex> {
  const raw = await fs.readFile(outputPath, "utf8");
  return JSON.parse(raw) as LabelsIndex;
}

export function labelClass(entry: LabelerClassRecord): ClassLabel[] {
  const labels = new Set<ClassLabel>();
  const name = entry.name.toLowerCase();
  const file = entry.file.toLowerCase();
  const hierarchy = [...(entry.extendsTypes ?? []), ...(entry.implementsTypes ?? [])].join(" ");

  if (name.endsWith("service")) {
    labels.add("SERVICE");
  }
  if (name.endsWith("dao")) {
    labels.add("DAO");
  }
  if (name.endsWith("controller") || name.endsWith("action")) {
    labels.add("CONTROLLER");
  }
  if (name.endsWith("util") || name.endsWith("utils")) {
    labels.add("UTIL");
  }
  if (name.endsWith("dto") || name.endsWith("vo")) {
    labels.add("DTO");
  }
  if (
    hierarchy.includes("TagSupport") ||
    hierarchy.includes("BodyTagSupport") ||
    hierarchy.includes("SimpleTagSupport") ||
    file.includes("/tag/")
  ) {
    labels.add("TAG_HANDLER");
  }

  if (labels.size === 0) {
    labels.add("UNKNOWN");
  }

  return Array.from(labels);
}

export function labelMethod(
  entry: LabelerMethodRecord,
  classLabels: ClassLabel[]
): MethodLabel[] {
  const labels = new Set<MethodLabel>();
  const name = entry.name;

  if (name === "doStartTag" || name === "doEndTag" || name === "doTag") {
    labels.add("TAG_ENTRYPOINT");
  }
  if (/^(get|set|is)[A-Z_]/.test(name)) {
    labels.add("ACCESSOR");
  }
  if (classLabels.includes("SERVICE") && entry.visibility !== "private") {
    labels.add("SERVICE_METHOD");
  }

  if (labels.size === 0) {
    labels.add("UNKNOWN");
  }

  return Array.from(labels);
}

export function labelJsp(entry: LabelerJspRecord): JspLabel[] {
  const normalized = entry.path.toLowerCase();
  const labels = new Set<JspLabel>();

  if (
    normalized.includes("/fragment/") ||
    normalized.includes("/include/") ||
    path.basename(normalized).startsWith("_")
  ) {
    labels.add("FRAGMENT");
  } else if (normalized.includes("/ajax/") || normalized.includes("ajax")) {
    labels.add("AJAX_VIEW");
  } else {
    labels.add("PAGE");
  }

  if (labels.size === 0) {
    labels.add("UNKNOWN");
  }

  return Array.from(labels);
}
