# LeflectJava

LeflectJava is a monorepo for Java/JSP static analysis focused on:

- Java file inventory and optional JavaParser full AST JSON export
- JSP/TLD parsing and tag-handler resolution
- index, graph, label, report, and query generation
- incremental analysis via `analysis/cache/*`

## Workspace

- Root package: `@leflect-java/workspace`
- CLI package: `@leflect-java/cli`
- CLI bin: `bin/leflect`

## Quick Start

```bash
pnpm install
pnpm build
node bin/leflect init --yes
node bin/leflect --help
```

- Config guide: `docs/config-guide.md`

## NPX CLI

You can build a single-file NPX-ready CLI package:

```bash
pnpm npx:build
```

This writes a tarball under `.artifacts/packages/` and bundles the workspace packages into one
CLI entry. If `java-worker/target/leflectjava-java-worker-*.jar` exists, it is copied into the
NPX package and auto-detected at runtime, so `npx` execution can still run full Java/JSP AST stages.

Example:

```bash
npx --yes --package file:/absolute/path/to/.artifacts/packages/leflect-java-0.1.0.tgz leflect --help
```

## Real Sample

The repository includes a runnable legacy Java 8 example flow based on
`spring-framework-petclinic` tag `v5.0.8`.

```bash
pnpm example:legacy-java8:fetch
pnpm example:legacy-java8:run
```

- Fetch script: `examples/legacy-java8-petclinic/fetch.sh`
- Run script: `examples/legacy-java8-petclinic/run.sh`
- Sample notes: `examples/legacy-java8-petclinic/README.md`

## Core Commands

```bash
node bin/leflect init --root ./repo
node bin/leflect scan --root ./repo --out ./analysis --incremental
node bin/leflect parse-tld --root ./repo --out ./analysis --incremental
node bin/leflect parse-jsp --root ./repo --out ./analysis --incremental
node bin/leflect build-index --analysis ./analysis
node bin/leflect build-graph --analysis ./analysis
node bin/leflect report summary --analysis ./analysis
node bin/leflect query tag-usages --analysis ./analysis --class FormTag
node bin/leflect analyze --root ./repo --out ./analysis --incremental
node bin/leflect dashboard-server --root ./repo --config ./repo/leflect.config.json --mode production --port 3210
```

When `java.workerJar` is configured, `parse-java` writes:

- full JavaParser AST JSON to `analysis/java-ast/**/*.json`
- summary IR for downstream indexing to `analysis/index/java-summary.jsonl`
- JavaParser semantic resolution can use `java.classpath` and Maven classpath auto-discovery
- worker launch can be pinned with `java.jreHome` or `java.javaHome`

If `java.workerJar` is not configured, the CLI also checks:

- `LEFLECT_JAVA_WORKER_JAR`
- bundled package worker manifest `java/worker-jar.json`
- bundled package worker location `java/leflectjava-java-worker-*.jar`
- workspace build location `java-worker/target/leflectjava-java-worker-*.jar`

If `classpathDiscovery.enabled` is `true`, LeflectJava can also augment Java/JSP classpath during
analysis by searching system JAR caches for:

- missing Java classes reported by the worker
- unresolved JSP taglib URIs

Default search roots:

- `~/.m2/repository`
- `~/.gradle/caches/modules-2/files-2.1`
- `~/.ivy2/cache`
- `/usr/share/java`

By default, `parse-jsp` writes:

- full JavaParser AST JSON to `analysis/jsp-ast/**/*.json`
- one AST JSON file per source `.jsp`, using the source-relative path
- Jasper resolves taglib dependencies from `jsp.classpath` and, when `pom.xml` is present,
  from Maven dependency classpath auto-discovery
- use `--jsp-ast-mode lightweight` or `jsp.astMode = "lightweight"` to skip Jasper AST generation

If `entryFiles.java` and/or `entryFiles.jsp` are configured, `build-graph` also writes
entry-rooted dependency subgraphs and per-file reference/dependant summaries.

## Dashboard

The repository now includes a Lit projection app under `apps/leflect-java-projection`.

`leflect dashboard-server` does not run analysis. It reads the `leflect.config.json`
you point to, resolves `analysisOut`, and serves the projection UI from the existing
analysis artifacts already written under that directory.

```bash
node bin/leflect dashboard-server \
  --root ./repo \
  --config ./repo/leflect.config.json \
  --mode production \
  --port 3210
```

What it uses:

- `analysis/report/summary.json`
- `analysis/index/java-files.json`
- `analysis/index/jsp-files.json`
- `analysis/index/java/**/*.json`
- `analysis/index/jsp/**/*.json`
- `analysis/graph/file-dependencies.json`
- `analysis/graph/file-dependency.jsonl`

The projection UI currently provides one dense, tab-based feature:

- left sidebar with all Java/JSP files from the analysis index
- center D3 dependency graph for the selected file
- right sidebar with source shard metadata plus references / referenced-by details
- compact header and bottom status bar for large codebases

## Analysis Output

After `node bin/leflect analyze --root ./repo --out ./analysis`, the `analysis/`
directory tells you what LeflectJava found and what downstream commands can consume.

```text
analysis/
  cache/
  files/
  generated-jsp-java/
  graph/
  index/
  java-ast/
  jsp-ast/
  jsp-meta/
  logs/
  manifests/
  report/
```

- `analysis/files/`
  - raw file inventory from `scan`
  - start here if you want to know which `.java`, `.jsp`, `.tld` files were discovered
- `analysis/manifests/`
  - per-stage input manifests generated by the CLI
  - useful for debugging which files each stage processed
- `analysis/java-ast/`
  - one full JavaParser AST JSON per `.java` source file
  - generated when `java.workerJar` is configured and `parse-java` runs
- `analysis/jsp-ast/`
  - one full JavaParser AST JSON per `.jsp` source file
  - default JSP AST output when `parse-jsp` runs in `jasper` mode
- `analysis/generated-jsp-java/`
  - intermediate Java servlet source generated by Jasper from JSP files
  - mainly for debugging JSP-to-Java conversion; not a final consumer artifact
- `analysis/jsp-meta/`
  - lightweight JSP metadata used by indexing
  - includes taglibs, custom tags, scriptlets, and optional AST references
- `analysis/index/`
  - primary machine-readable analysis outputs
  - designed for large codebases: source metadata is sharded per `.java` / `.jsp` file instead of one giant aggregate file
  - top-level manifests include `java-files.json`, `jsp-files.json`, `reverse-index.json`, `taglibs.json`, `labels.json`
  - Java-specific metadata:
    - `java-files.json`: per-source manifest with `metadataPath`, class/method/call counts
    - `java/**/*.json`: one metadata file per `.java` source, containing imports, classes, methods, calls, class references
  - JSP-specific metadata:
    - `jsp-files.json`: per-source manifest with `metadataPath` and per-file counts
    - `jsp/**/*.json`: one metadata file per `.jsp` source, containing imports, taglibs, tags, scriptlets, references, method calls
  - import records include stable `id` values and simple-name metadata for cross-reference matching
  - method call records include `classPath`, `importId`, `inputParameters`, `responseType`
  - Java/JSP reference and call records include `line`, `column`, `endLine`, `endColumn` when available
  - if you want to integrate LeflectJava with another tool, this is usually the best starting point
- `analysis/graph/`
  - edge-oriented graph outputs such as Java call edges and JSP-to-Java links
  - `java-call.jsonl`: class-level Java call edges
  - `jsp-java.jsonl`: JSP-to-Java/tag edges
  - `file-dependency.jsonl`: file-level dependency edges derived from Java/JSP graph edges
  - `file-dependencies.json`: per `.java`/`.jsp` file summary with `referenceCount`, `dependantCount`, `references`, and `referencedBy`
  - `entry-dependencies.json`: entry-file matches from config and the reachable dependency subgraph for each entry
  - useful when you want impact analysis, graph ingestion, or entry-rooted dependency tracing
- `analysis/report/`
  - final human-facing summary outputs
  - includes `summary.json`, `unresolved.json`, and `impact.md`
  - `unresolved.json` now includes:
    - `edges`: unresolved graph edges
    - `diagnostics`: normalized problem records with `stage`, `severity`, `path`, `category`, `summary`, `message`, optional `hint`, `location`, `snippet`, and related metadata
    - `byPath`: the same diagnostics grouped by source path so repository reviews can focus file-by-file
  - this is the best place to inspect what LeflectJava concluded about the repository
- `analysis/cache/`
  - incremental execution state, file hashes, and per-stage cache metadata
  - useful for reruns, not for direct analysis consumption
- `analysis/logs/`
  - parse error logs from Java/JSP worker stages
  - `java-parse-errors.jsonl` and `jsp-parse-errors.jsonl` use the same diagnostic schema as `report/unresolved.json`
  - when location is available, each record includes `line`, `column`, `endLine`, `endColumn`, and a source `snippet`
  - inspect this when AST output is missing or incomplete

In practice:

- inspect `analysis/report/` to understand the final result
- inspect `analysis/index/` to build tooling on top of LeflectJava
- inspect `analysis/java-ast/` and `analysis/jsp-ast/` when you need full AST-level inspection
- inspect `analysis/logs/` and `analysis/manifests/` when a stage behaves unexpectedly

## Init Wizard

`leflect init` writes `leflect.config.json` for the target source root.

Interactive:

```bash
node bin/leflect init --root ./repo
```

Non-interactive defaults:

```bash
node bin/leflect init --root ./repo --yes
```

The wizard detects and can write:

- `analysisOut`, `ignoreFile`, `labelsOut`
- `jsp.webappRoot` and `jsp.astMode`
- `java.jreHome`, `java.javaHome`
- Java/JSP Maven classpath discovery commands
- Java/JSP extra classpath entries
- automatic system classpath discovery settings
- `entryFiles.java`, `entryFiles.jsp`

## Release

Workspace packages publish under the `@leflect-java/*` scope.

```bash
pnpm release:prepare
pnpm release:publish
pnpm release:prepare:next
pnpm release:publish:next
```

- `pnpm release:prepare`
  - runs `release:check`
  - stages publishable packages under `.artifacts/release/stage`
  - rewrites `workspace:*` dependencies to actual module versions
  - packs each staged module into `.artifacts/release/packages`
  - builds standalone binary npm packages for the default target matrix
- `pnpm release:publish`
  - performs the same staging flow
  - publishes staged packages to npm with `--access public`
- `pnpm release:publish:next`
  - publishes new versions with dist-tag `next`
  - if the version already exists, applies `npm dist-tag add <pkg>@<version> next` instead of trying to republish

Standalone binary build:

```bash
pnpm binary:build
pnpm binary:test
pnpm binary:build:all
pnpm binary:test:all
```

- output binary: `.artifacts/binary/dist/leflect`
- output npm package: `.artifacts/binary/npm-package`
- current package name format: `@leflect-java/cli-binary-<platform>-<arch>`
- default binary matrix:
  - `darwin-arm64`
  - `darwin-x64`
  - `linux-x64`
  - `linux-arm64`
  - `win32-x64`
- matrix output root: `.artifacts/binary-matrix/`

Useful overrides:

- `--force`
- `--worker-jar`
- `--jre-home`
- `--java-home`
- `--java-classpath`
- `--jsp-classpath`
- `--java-maven-command`
- `--jsp-maven-command`
- `--jsp-webapp-root`
- `--auto-system-classpath`
- `--system-classpath-roots`
- `--system-classpath-max-retries`
- `--entry-java`
- `--entry-jsp`

## Validation

```bash
pnpm release:check
```

## Release Notes

- CI is defined in `.github/workflows/ci.yml`
- Release checklist is documented in `docs/release-checklist.md`
- Integration/E2E fixtures live under `tests/fixtures/`
