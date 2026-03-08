import fs from "fs/promises";
import path from "path";

export type ClassIndexEntry = {
  id: string;
  name: string;
  file: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
};

export type MethodIndexEntry = {
  id: string;
  name: string;
  classId?: string;
  file?: string;
};

export type CallIndexEntry = {
  from?: string;
  to?: string;
  fromClassId?: string;
  toClassId?: string;
  fromMethodId?: string;
  toMethodId?: string;
  fromFile?: string;
  toFile?: string;
};

export type JavaIndex = {
  classes: ClassIndexEntry[];
  methods: MethodIndexEntry[];
  calls: CallIndexEntry[];
};

export type JavaSummaryMethod = {
  id: string;
  name: string;
  returnType?: string;
  parameters?: string[];
  calls?: string[];
};

export type JavaSummaryType = {
  name: string;
  fqn: string;
  kind?: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
  methods?: JavaSummaryMethod[];
};

export type JavaSummaryRecord = {
  path: string;
  sourceKind?: string;
  packageName?: string;
  imports?: string[];
  types?: JavaSummaryType[];
};

export type WorkerIndex = {
  files: string[];
  summaries?: JavaSummaryRecord[];
};

export function buildJavaIndex(workerIndex: WorkerIndex): JavaIndex {
  const summaries = workerIndex.summaries ?? [];
  if (summaries.length === 0) {
    return buildFallbackJavaIndex(workerIndex.files);
  }

  const classes: ClassIndexEntry[] = [];
  const methods: MethodIndexEntry[] = [];
  const calls: CallIndexEntry[] = [];
  const classIds = new Set<string>();
  const methodIds = new Set<string>();
  const callKeys = new Set<string>();

  for (const summary of summaries) {
    const file = normalizePath(summary.path);
    for (const type of summary.types ?? []) {
      if (!classIds.has(type.fqn)) {
        classes.push({
          id: type.fqn,
          name: type.name,
          file,
          extendsTypes: type.extendsTypes ?? [],
          implementsTypes: type.implementsTypes ?? []
        });
        classIds.add(type.fqn);
      }

      for (const method of type.methods ?? []) {
        if (!methodIds.has(method.id)) {
          methods.push({
            id: method.id,
            name: method.name,
            classId: type.fqn,
            file
          });
          methodIds.add(method.id);
        }

        for (const target of method.calls ?? []) {
          const normalizedTarget = normalizeCallTarget(target);
          const toClassId = normalizedTarget ? extractClassId(normalizedTarget) : undefined;
          const toMethodId = normalizedTarget && normalizedTarget.includes("#")
            ? normalizedTarget
            : undefined;
          const unresolvedTarget = normalizedTarget
            ? `unresolved:java-call:${method.id}:${normalizedTarget}`
            : `unresolved:java-call:${method.id}:unknown`;
          const key = [
            method.id,
            toMethodId ?? "",
            toClassId ?? "",
            unresolvedTarget
          ].join("|");

          if (callKeys.has(key)) {
            continue;
          }

          calls.push({
            from: method.id,
            to: toClassId ?? unresolvedTarget,
            fromClassId: type.fqn,
            toClassId,
            fromMethodId: method.id,
            toMethodId,
            fromFile: file
          });
          callKeys.add(key);
        }
      }
    }
  }

  classes.sort((left, right) => left.id.localeCompare(right.id));
  methods.sort((left, right) => left.id.localeCompare(right.id));
  calls.sort((left, right) =>
    `${left.fromMethodId ?? left.from}|${left.toMethodId ?? left.to}`.localeCompare(
      `${right.fromMethodId ?? right.from}|${right.toMethodId ?? right.to}`
    )
  );

  return { classes, methods, calls };
}

export async function readWorkerIndex(workerIndexPath: string): Promise<WorkerIndex> {
  const raw = await fs.readFile(workerIndexPath, "utf8");
  const payload = JSON.parse(raw) as { files?: string[] };

  return {
    files: payload.files ?? []
  };
}

export async function readJavaSummaryIndex(summaryPath: string): Promise<JavaSummaryRecord[]> {
  try {
    const raw = await fs.readFile(summaryPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as JavaSummaryRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeJavaIndex(outDir: string, index: JavaIndex): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });

  await fs.writeFile(
    path.join(outDir, "classes.json"),
    JSON.stringify(index.classes, null, 2)
  );
  await fs.writeFile(
    path.join(outDir, "methods.json"),
    JSON.stringify(index.methods, null, 2)
  );
  await fs.writeFile(
    path.join(outDir, "calls.json"),
    JSON.stringify(index.calls, null, 2)
  );
}

function buildFallbackJavaIndex(files: string[]): JavaIndex {
  const classes = files.map((file) => {
    const name = path.basename(file, path.extname(file));
    return {
      id: name,
      name,
      file: normalizePath(file)
    };
  });

  return {
    classes,
    methods: [],
    calls: []
  };
}

function normalizeCallTarget(target: string): string | undefined {
  const normalized = target.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractClassId(target: string): string | undefined {
  const symbol = target.startsWith("unresolved:") ? undefined : target;
  if (!symbol) {
    return undefined;
  }

  const hashIndex = symbol.indexOf("#");
  if (hashIndex >= 0) {
    return symbol.slice(0, hashIndex);
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
