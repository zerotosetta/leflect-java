import fs from "fs/promises";
import path from "path";

export type ClassIndexEntry = {
  id: string;
  name: string;
  file: string;
};

export type JavaIndex = {
  classes: ClassIndexEntry[];
  methods: Array<Record<string, never>>;
  calls: Array<Record<string, never>>;
};

export type WorkerIndex = {
  files: string[];
};

export function buildJavaIndex(workerIndex: WorkerIndex): JavaIndex {
  const classes = workerIndex.files.map((file) => {
    const name = path.basename(file, path.extname(file));
    return {
      id: name,
      name,
      file
    };
  });

  return {
    classes,
    methods: [],
    calls: []
  };
}

export async function readWorkerIndex(workerIndexPath: string): Promise<WorkerIndex> {
  const raw = await fs.readFile(workerIndexPath, "utf8");
  const payload = JSON.parse(raw) as { files?: string[] };

  return {
    files: payload.files ?? []
  };
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
