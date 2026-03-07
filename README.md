# LeflectJava

LeflectJava is a monorepo for Java/JSP static analysis focused on:

- Java file inventory and optional JavaParser AST export
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

## Validation

```bash
pnpm release:check
```

## Release Notes

- CI is defined in `.github/workflows/ci.yml`
- Release checklist is documented in `docs/release-checklist.md`
- Integration/E2E fixtures live under `tests/fixtures/`
