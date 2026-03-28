# @leflect-java/java-bridge

`@leflect-java/java-bridge` is the low-level bridge between Node.js and the shaded Java worker JAR.

Use this package when you want:

- to write Java or JSP worker manifests yourself
- to construct `java -jar ...` commands explicitly
- to spawn the worker without pulling in the full CLI orchestration layer

If you want end-to-end analysis, prefer [`@leflect-java/cli`](../cli/README.md) and `analyzeWorkspace()`.
If you want the normalized consumer-facing schema, prefer the sharded index written by [`@leflect-java/indexer`](../indexer/README.md) instead of reading worker output directly.

## Programmatic Usage

```ts
import {
  runJavaWorker,
  writeJavaManifest
} from "@leflect-java/java-bridge";

await writeJavaManifest("/repo/analysis/manifests/java-parse.json", {
  root: "/repo",
  files: ["src/main/java/demo/App.java"],
  outputDir: "/repo/analysis/java-ast",
  classpathEntries: [],
  errorLog: "/repo/analysis/logs/java-parse-errors.jsonl"
});

const result = await runJavaWorker({
  jarPath: "/repo/java-worker/target/leflectjava-java-worker-0.1.0.jar",
  args: ["parse-java", "--manifest", "/repo/analysis/manifests/java-parse.json"],
  cwd: "/repo"
});
```

## What This Package Does Not Do

- it does not scan the workspace
- it does not build indexes, graphs, or reports
- it does not decide stage ordering or incremental behavior

Those concerns belong to `@leflect-java/cli`.
