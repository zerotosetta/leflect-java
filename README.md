# LeflectJava

LeflectJava is a monorepo for Java/JSP static analysis focused on:

- Java file inventory and optional JavaParser full AST JSON export
- JSP/TLD parsing and tag-handler resolution
- index, graph, label, report, and query generation
- incremental analysis via `analysis/cache/*`

## Workspace

- Root package: `@lefectjava/workspace`
- CLI package: `@lefectjava/cli`
- CLI bin: `bin/leflect`

## Quick Start

```bash
pnpm install
pnpm build
node bin/leflect --help
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
node bin/leflect scan --root ./repo --out ./analysis --incremental
node bin/leflect parse-tld --root ./repo --out ./analysis --incremental
node bin/leflect parse-jsp --root ./repo --out ./analysis --incremental
node bin/leflect build-index --analysis ./analysis
node bin/leflect build-graph --analysis ./analysis
node bin/leflect report summary --analysis ./analysis
node bin/leflect query tag-usages --analysis ./analysis --class FormTag
node bin/leflect analyze --root ./repo --out ./analysis --incremental
```

When `java.workerJar` is configured, `parse-java` writes:

- full JavaParser AST JSON to `analysis/java-ast/**/*.json`
- summary IR for downstream indexing to `analysis/index/java-summary.jsonl`

By default, `parse-jsp` writes:

- full JavaParser AST JSON to `analysis/jsp-ast/**/*.json`
- one AST JSON file per source `.jsp`, using the source-relative path
- use `--jsp-ast-mode lightweight` or `jsp.astMode = "lightweight"` to skip Jasper AST generation

## Validation

```bash
pnpm release:check
```

## Release Notes

- CI is defined in `.github/workflows/ci.yml`
- Release checklist is documented in `docs/release-checklist.md`
- Integration/E2E fixtures live under `tests/fixtures/`
