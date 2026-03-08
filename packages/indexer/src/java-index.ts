import fs from "fs/promises";
import path from "path";

export type ClassIndexEntry = {
  id: string;
  name: string;
  file: string;
  packageName?: string;
  sourceKind?: string;
  kind?: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
  location?: JavaSourceLocation;
};

export type MethodIndexEntry = {
  id: string;
  name: string;
  classId?: string;
  file?: string;
  returnType?: string;
  parameters?: string[];
  callTargets?: string[];
  location?: JavaSourceLocation;
};

export type MethodCallParameterEntry = {
  index: number;
  type?: string;
  value?: string;
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
  rawTarget?: string;
  methodName?: string;
  classPath?: string;
  importId?: string;
  inputParameters?: MethodCallParameterEntry[];
  responseType?: string;
  location?: JavaSourceLocation;
  snippet?: string;
};

export type JavaFileIndexEntry = {
  path: string;
  sourceKind?: string;
  packageName?: string;
  imports: string[];
  importIds: string[];
  classIds: string[];
  methodIds: string[];
  callTargets: string[];
};

export type JavaImportIndexEntry = {
  id: string;
  file: string;
  import: string;
  simpleName?: string;
  location?: JavaSourceLocation;
};

export type JavaClassReferenceIndexEntry = {
  file: string;
  className: string;
  qualifiedName?: string;
  classPath?: string;
  importId?: string;
  kind?: string;
  location?: JavaSourceLocation;
  snippet?: string;
};

export type JavaFileMetadata = JavaFileIndexEntry & {
  importEntries: JavaImportIndexEntry[];
  classes: ClassIndexEntry[];
  methods: MethodIndexEntry[];
  calls: CallIndexEntry[];
  classReferences: JavaClassReferenceIndexEntry[];
};

export type JavaIndex = {
  files: JavaFileIndexEntry[];
  imports: JavaImportIndexEntry[];
  classes: ClassIndexEntry[];
  methods: MethodIndexEntry[];
  calls: CallIndexEntry[];
  classReferences: JavaClassReferenceIndexEntry[];
};

export type JavaSourceLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type JavaSummaryMethod = {
  id: string;
  name: string;
  returnType?: string;
  parameters?: string[];
  calls?: string[];
  location?: JavaSourceLocation;
};

export type JavaSummaryType = {
  name: string;
  fqn: string;
  kind?: string;
  extendsTypes?: string[];
  implementsTypes?: string[];
  methods?: JavaSummaryMethod[];
  location?: JavaSourceLocation;
};

export type JavaSummaryClassReference = {
  symbol: string;
  qualifiedName?: string;
  kind?: string;
  snippet?: string;
  location?: JavaSourceLocation;
};

export type JavaSummaryMethodCall = {
  callerMethodId?: string;
  callerClassId?: string;
  target: string;
  targetClassId?: string;
  targetMethodId?: string;
  targetMethodName?: string;
  classPath?: string;
  parameterTypes?: string[];
  argumentExpressions?: string[];
  responseType?: string;
  snippet?: string;
  location?: JavaSourceLocation;
};

export type JavaSummaryRecord = {
  path: string;
  sourceKind?: string;
  packageName?: string;
  imports?: string[];
  types?: JavaSummaryType[];
  classReferences?: JavaSummaryClassReference[];
  methodCalls?: JavaSummaryMethodCall[];
};

export type WorkerIndex = {
  files: string[];
  summaries?: JavaSummaryRecord[];
};

type JavaImportLookup = {
  byExact: Map<string, string>;
  bySimple: Map<string, string>;
  wildcards: JavaImportIndexEntry[];
};

type PendingJavaCall = {
  file: string;
  lookup: JavaImportLookup;
  record: JavaSummaryMethodCall;
};

export function buildJavaIndex(workerIndex: WorkerIndex): JavaIndex {
  const summaries = workerIndex.summaries ?? [];
  if (summaries.length === 0) {
    return buildFallbackJavaIndex(workerIndex.files);
  }

  const files: JavaFileIndexEntry[] = [];
  const imports: JavaImportIndexEntry[] = [];
  const classes: ClassIndexEntry[] = [];
  const methods: MethodIndexEntry[] = [];
  const calls: CallIndexEntry[] = [];
  const classReferences: JavaClassReferenceIndexEntry[] = [];

  const classIds = new Set<string>();
  const methodIds = new Set<string>();
  const callKeys = new Set<string>();
  const pendingCalls: PendingJavaCall[] = [];

  for (const summary of summaries) {
    const file = normalizePath(summary.path);
    const fileImports = collectUnique(summary.imports ?? []);
    const fileClassIds: string[] = [];
    const fileMethodIds: string[] = [];
    const fileCallTargets: string[] = [];
    const importLocations = new Map<string, JavaSourceLocation | undefined>();

    for (const reference of summary.classReferences ?? []) {
      if (reference.kind?.startsWith("import")) {
        importLocations.set(reference.qualifiedName ?? reference.symbol, reference.location);
      }
    }

    const fileImportEntries = fileImports.map((entry) => ({
      id: buildImportId(file, entry),
      file,
      import: entry,
      simpleName: extractSimpleName(entry),
      location: importLocations.get(entry)
    }));
    const lookup = createImportLookup(fileImportEntries);
    imports.push(...fileImportEntries);

    for (const reference of summary.classReferences ?? []) {
      const classPath = reference.qualifiedName ?? resolveClassPath(reference.symbol, lookup);
      classReferences.push({
        file,
        className: reference.symbol,
        qualifiedName: reference.qualifiedName,
        classPath,
        importId: resolveImportId(lookup, classPath, reference.symbol),
        kind: reference.kind,
        location: reference.location,
        snippet: reference.snippet
      });
    }

    for (const type of summary.types ?? []) {
      fileClassIds.push(type.fqn);

      if (!classIds.has(type.fqn)) {
        classes.push({
          id: type.fqn,
          name: type.name,
          file,
          packageName: summary.packageName,
          sourceKind: summary.sourceKind,
          kind: type.kind,
          extendsTypes: type.extendsTypes ?? [],
          implementsTypes: type.implementsTypes ?? [],
          location: type.location
        });
        classIds.add(type.fqn);
      }

      for (const method of type.methods ?? []) {
        fileMethodIds.push(method.id);

        if (!methodIds.has(method.id)) {
          methods.push({
            id: method.id,
            name: method.name,
            classId: type.fqn,
            file,
            returnType: method.returnType,
            parameters: method.parameters ?? [],
            callTargets: collectUnique(method.calls ?? []),
            location: method.location
          });
          methodIds.add(method.id);
        }
      }
    }

    const summaryCalls = summary.methodCalls?.length
      ? summary.methodCalls
      : flattenMethodCalls(summary.types ?? []);

    for (const callRecord of summaryCalls) {
      const normalizedTarget = normalizeCallTarget(callRecord.target);
      if (!normalizedTarget) {
        continue;
      }
      fileCallTargets.push(normalizedTarget);
      pendingCalls.push({ file, lookup, record: callRecord });
    }

    files.push({
      path: file,
      sourceKind: summary.sourceKind,
      packageName: summary.packageName,
      imports: fileImports,
      importIds: fileImportEntries.map((entry) => entry.id),
      classIds: collectUnique(fileClassIds),
      methodIds: collectUnique(fileMethodIds),
      callTargets: collectUnique(fileCallTargets)
    });
  }

  const methodsById = new Map(methods.map((method) => [method.id, method]));
  const methodsByClassAndName = groupMethodsByClassAndName(methods);

  for (const pending of pendingCalls) {
    const call = buildCallIndexEntry(pending, methodsById, methodsByClassAndName);
    if (!call) {
      continue;
    }

    const key = [
      call.fromMethodId ?? "",
      call.toMethodId ?? "",
      call.to ?? "",
      call.rawTarget ?? "",
      serializeLocation(call.location)
    ].join("|");
    if (callKeys.has(key)) {
      continue;
    }
    calls.push(call);
    callKeys.add(key);
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  imports.sort((left, right) => `${left.file}:${left.import}`.localeCompare(`${right.file}:${right.import}`));
  classes.sort((left, right) => left.id.localeCompare(right.id));
  methods.sort((left, right) => left.id.localeCompare(right.id));
  calls.sort(compareCalls);
  classReferences.sort((left, right) =>
    `${left.file}:${left.classPath ?? left.className}:${serializeLocation(left.location)}`.localeCompare(
      `${right.file}:${right.classPath ?? right.className}:${serializeLocation(right.location)}`
    )
  );

  return { files, imports, classes, methods, calls, classReferences };
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

  await fs.writeFile(path.join(outDir, "java-files.json"), JSON.stringify(index.files, null, 2));
  await fs.writeFile(path.join(outDir, "java-imports.json"), JSON.stringify(index.imports, null, 2));
  await fs.writeFile(path.join(outDir, "java-classes.json"), JSON.stringify(index.classes, null, 2));
  await fs.writeFile(path.join(outDir, "java-methods.json"), JSON.stringify(index.methods, null, 2));
  await fs.writeFile(path.join(outDir, "java-calls.json"), JSON.stringify(index.calls, null, 2));
  await fs.writeFile(
    path.join(outDir, "java-class-references.json"),
    JSON.stringify(index.classReferences, null, 2)
  );
  await fs.writeFile(
    path.join(outDir, "java-method-calls.json"),
    JSON.stringify(index.calls, null, 2)
  );

  await fs.writeFile(path.join(outDir, "classes.json"), JSON.stringify(index.classes, null, 2));
  await fs.writeFile(path.join(outDir, "methods.json"), JSON.stringify(index.methods, null, 2));
  await fs.writeFile(path.join(outDir, "calls.json"), JSON.stringify(index.calls, null, 2));

  await writePerFileMetadata(path.join(outDir, "java"), toJavaFileMetadata(index));
}

function buildFallbackJavaIndex(files: string[]): JavaIndex {
  const normalizedFiles = files.map((file) => normalizePath(file)).sort();
  const fileEntries: JavaFileIndexEntry[] = [];
  const classes: ClassIndexEntry[] = [];

  for (const file of normalizedFiles) {
    const name = path.basename(file, path.extname(file));
    classes.push({
      id: name,
      name,
      file
    });
    fileEntries.push({
      path: file,
      imports: [],
      importIds: [],
      classIds: [name],
      methodIds: [],
      callTargets: []
    });
  }

  return {
    files: fileEntries,
    imports: [],
    classes,
    methods: [],
    calls: [],
    classReferences: []
  };
}

function toJavaFileMetadata(index: JavaIndex): JavaFileMetadata[] {
  return index.files.map((file) => ({
    ...file,
    importEntries: index.imports.filter((entry) => entry.file === file.path),
    classes: index.classes.filter((entry) => entry.file === file.path),
    methods: index.methods.filter((entry) => entry.file === file.path),
    calls: index.calls.filter((entry) => entry.fromFile === file.path),
    classReferences: index.classReferences.filter((entry) => entry.file === file.path)
  }));
}

function buildCallIndexEntry(
  pending: PendingJavaCall,
  methodsById: Map<string, MethodIndexEntry>,
  methodsByClassAndName: Map<string, MethodIndexEntry[]>
): CallIndexEntry | undefined {
  const normalizedTarget = normalizeCallTarget(pending.record.target);
  if (!normalizedTarget) {
    return undefined;
  }

  const explicitClassPath = pending.record.classPath ?? pending.record.targetClassId;
  const targetMethodName = pending.record.targetMethodName ?? extractMethodName(normalizedTarget);
  const inferredMethod = resolveMethodEntry(
    pending.record.targetMethodId,
    explicitClassPath,
    targetMethodName,
    pending.record.argumentExpressions?.length,
    methodsById,
    methodsByClassAndName
  );
  const classPath = explicitClassPath ?? inferredMethod?.classId ?? extractClassId(normalizedTarget);
  const toMethodId = pending.record.targetMethodId ?? inferredMethod?.id ?? (
    normalizedTarget.includes("#") ? normalizedTarget : undefined
  );
  const unresolvedTarget = classPath
    ? classPath
    : `unresolved:java-call:${pending.record.callerMethodId ?? "unknown"}:${normalizedTarget}`;

  return {
    from: pending.record.callerMethodId,
    to: classPath ?? unresolvedTarget,
    fromClassId: pending.record.callerClassId,
    toClassId: classPath,
    fromMethodId: pending.record.callerMethodId,
    toMethodId,
    fromFile: pending.file,
    toFile: inferredMethod?.file,
    rawTarget: normalizedTarget,
    methodName: targetMethodName,
    classPath,
    importId: resolveImportId(pending.lookup, classPath, extractSimpleName(classPath)),
    inputParameters: buildMethodCallParameters(
      pending.record.parameterTypes ?? inferredMethod?.parameters,
      pending.record.argumentExpressions
    ),
    responseType: pending.record.responseType ?? inferredMethod?.returnType,
    location: pending.record.location,
    snippet: pending.record.snippet
  };
}

function groupMethodsByClassAndName(methods: MethodIndexEntry[]): Map<string, MethodIndexEntry[]> {
  const grouped = new Map<string, MethodIndexEntry[]>();

  for (const method of methods) {
    if (!method.classId) {
      continue;
    }
    const key = `${method.classId}#${method.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), method]);
  }

  return grouped;
}

function resolveMethodEntry(
  targetMethodId: string | undefined,
  classPath: string | undefined,
  methodName: string | undefined,
  argumentCount: number | undefined,
  methodsById: Map<string, MethodIndexEntry>,
  methodsByClassAndName: Map<string, MethodIndexEntry[]>
): MethodIndexEntry | undefined {
  if (targetMethodId && methodsById.has(targetMethodId)) {
    return methodsById.get(targetMethodId);
  }
  if (!classPath || !methodName) {
    return undefined;
  }

  const candidates = methodsByClassAndName.get(`${classPath}#${methodName}`) ?? [];
  if (candidates.length === 0) {
    return undefined;
  }
  if (argumentCount === undefined) {
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  const arityMatches = candidates.filter((candidate) => (candidate.parameters?.length ?? 0) === argumentCount);
  return arityMatches.length === 1 ? arityMatches[0] : undefined;
}

function buildMethodCallParameters(
  parameterTypes?: string[],
  argumentExpressions?: string[]
): MethodCallParameterEntry[] | undefined {
  const size = Math.max(parameterTypes?.length ?? 0, argumentExpressions?.length ?? 0);
  if (size === 0) {
    return undefined;
  }

  return Array.from({ length: size }, (_, index) => ({
    index,
    type: parameterTypes?.[index],
    value: argumentExpressions?.[index]
  }));
}

function createImportLookup(entries: JavaImportIndexEntry[]): JavaImportLookup {
  const byExact = new Map<string, string>();
  const bySimple = new Map<string, string>();
  const wildcards: JavaImportIndexEntry[] = [];

  for (const entry of entries) {
    byExact.set(entry.import, entry.id);
    if (entry.import.endsWith(".*")) {
      wildcards.push(entry);
      continue;
    }
    if (entry.simpleName) {
      bySimple.set(entry.simpleName, entry.id);
    }
  }

  return { byExact, bySimple, wildcards };
}

function resolveImportId(
  lookup: JavaImportLookup,
  classPath?: string,
  symbol?: string
): string | undefined {
  if (classPath && lookup.byExact.has(classPath)) {
    return lookup.byExact.get(classPath);
  }

  const simpleName = extractSimpleName(classPath ?? symbol);
  if (simpleName && lookup.bySimple.has(simpleName)) {
    return lookup.bySimple.get(simpleName);
  }

  if (classPath) {
    for (const wildcard of lookup.wildcards) {
      const prefix = wildcard.import.slice(0, -2);
      if (classPath.startsWith(`${prefix}.`)) {
        return wildcard.id;
      }
    }
  }

  return undefined;
}

function resolveClassPath(symbol: string | undefined, lookup: JavaImportLookup): string | undefined {
  if (!symbol) {
    return undefined;
  }
  if (symbol.includes(".")) {
    return symbol;
  }

  const importId = lookup.bySimple.get(symbol);
  if (!importId) {
    return undefined;
  }

  for (const [qualifiedImport, id] of lookup.byExact.entries()) {
    if (id === importId && !qualifiedImport.endsWith(".*")) {
      return qualifiedImport;
    }
  }

  return undefined;
}

function buildImportId(file: string, value: string): string {
  return `java-import:${file}:${value}`;
}

function extractMethodName(target: string): string | undefined {
  const hashIndex = target.indexOf("#");
  if (hashIndex >= 0) {
    const openParen = target.indexOf("(", hashIndex);
    return openParen >= 0 ? target.slice(hashIndex + 1, openParen) : target.slice(hashIndex + 1);
  }
  return target.trim() || undefined;
}

function normalizeCallTarget(target: string): string | undefined {
  const normalized = target.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractClassId(target: string): string | undefined {
  if (target.startsWith("unresolved:")) {
    return undefined;
  }
  const hashIndex = target.indexOf("#");
  if (hashIndex >= 0) {
    return target.slice(0, hashIndex);
  }
  return undefined;
}

function compareCalls(left: CallIndexEntry, right: CallIndexEntry): number {
  return (
    (left.fromFile ?? "").localeCompare(right.fromFile ?? "") ||
    (left.fromMethodId ?? left.from ?? "").localeCompare(right.fromMethodId ?? right.from ?? "") ||
    (left.toMethodId ?? left.to ?? "").localeCompare(right.toMethodId ?? right.to ?? "") ||
    (left.rawTarget ?? "").localeCompare(right.rawTarget ?? "") ||
    serializeLocation(left.location).localeCompare(serializeLocation(right.location))
  );
}

async function writePerFileMetadata(outDir: string, files: JavaFileMetadata[]): Promise<void> {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const entry of files) {
    const target = path.join(outDir, `${entry.path}.json`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(entry, null, 2));
  }
}

function collectUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function flattenMethodCalls(types: JavaSummaryType[]): JavaSummaryMethodCall[] {
  return types.flatMap((type) =>
    (type.methods ?? []).flatMap((method) =>
      (method.calls ?? []).map((target) => ({
        callerMethodId: method.id,
        callerClassId: type.fqn,
        target,
        targetMethodName: extractMethodName(target)
      }))
    )
  );
}

function serializeLocation(location?: JavaSourceLocation): string {
  if (!location) {
    return "";
  }
  return [
    location.line ?? "",
    location.column ?? "",
    location.endLine ?? "",
    location.endColumn ?? ""
  ].join(":");
}

function extractSimpleName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.endsWith(".*") ? value.slice(0, -2) : value;
  const segments = normalized.split(".");
  return segments.at(-1);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
