# @leflect-java/cli

`@leflect-java/cli` is the public orchestration surface for LeflectJava.

Use this package when you want:

- the `leflect` command-line interface
- a high-level programmatic entrypoint for end-to-end analysis
- a stable place to run scan, parse, index, graph, and report stages together
- analysis artifacts that downstream reimplementation workflows can consume without scraping CLI logs
- config-first JSP semantic AST output driven by `leflect.config.ts`

Use `@leflect-java/java-bridge` only when you need low-level control over worker manifests and process spawning.

## CLI Usage

```bash
leflect analyze --root ./repo --out ./analysis --incremental
leflect analyze --root ./repo --out ./analysis --incremental --quiet
leflect analyze --root ./repo --out ./analysis --incremental --format json
leflect query tag-usages --analysis ./analysis --class com.example.FormTag --format json
```

- `--quiet` suppresses progress/status logs for `scan`, `parse-*`, `build-*`, and `analyze`
- `analyze --format json` prints a single machine-readable payload based on `AnalyzeWorkspaceResult`
- text-mode `analyze` continues to print the final summary report JSON

## Programmatic Usage

```ts
import { analyzeWorkspace } from "@leflect-java/cli";

const result = await analyzeWorkspace({
  root: "/absolute/path/to/repo",
  analysisOut: "/absolute/path/to/repo/analysis",
  incremental: true,
  jspAstMode: "lightweight",
  onEvent(event) {
    console.error(`[${event.stage}] ${event.status}: ${event.message}`);
  }
});

console.log(result.reports.summary.counts);
```

`analyzeWorkspace()` does not write to stdout. It returns:

- resolved config
- worker resolution status
- per-stage results
- final `reports.summary`

Machine consumers should read the generated sharded metadata under `analysis/index/java/**/*.json` after `analyzeWorkspace()` completes. Those files now include ordered method steps, field initializer metadata, and normalized aliases such as `type`, `targetText`, and `lineRange`.

For JSP integrations, the same analysis run now emits:

- `analysis/index/taglib-registry.json` as the canonical raw TLD registry
- `analysis/jsp-semantic/**/*.json` as full semantic JSP AST files
- `analysis/index/jsp-files.json` semantic summary fields such as `semanticAstPath`, `semanticQueryCount`, and `semanticDiagnosticCount`

`jsp.taglibResolvers` and `jsp.tld.*` are configured in `leflect.config.ts`, not through CLI-only flags. See [`docs/config-guide.md`](../../docs/config-guide.md) and [`docs/jsp-tld-semantic-guide.md`](../../docs/jsp-tld-semantic-guide.md).

## API Notes

- `run(argv)` remains the CLI-compatible entrypoint used by the `leflect` binary
- `AnalyzeWorkspaceOptions` accepts resolved-path overrides such as `configPath`, `analysisOut`, `ignoreFile`, and `labelsOut`
- classpath discovery overrides can be passed programmatically through `classpathDiscovery`

## Related Packages

- [`@leflect-java/indexer`](../indexer/README.md): turns worker summaries and JSP metadata into sharded machine-readable indexes
- [`@leflect-java/java-bridge`](../java-bridge/README.md): low-level Java worker manifest and process helpers
