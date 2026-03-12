# TypeScript Config Account Flow Example

This sample keeps the codebase small while demonstrating the new configuration features:

- `leflect.config.ts` with `defineConfig(...)`
- explicit `entries` with entry fan-out, variants, and deferred query/interface targets
- local TypeScript plugin modules imported from the config file
- file-pattern entry matching through `entryFiles`

Run it from the workspace root:

```bash
pnpm example:ts-config:run
```

Or run the CLI directly:

```bash
node bin/leflect analyze \
  --root examples/ts-config-account-flow \
  --config examples/ts-config-account-flow/leflect.config.ts
```

Important notes:

- The sample uses `jsp.astMode = "lightweight"` so it stays runnable without compiling the sample classes for Jasper.
- Java AST export still runs when a worker JAR is available through the workspace build, `LEFLECT_JAVA_WORKER_JAR`, or the packaged CLI bundle.
- Plugin hooks are scaffolded through the public API. The current pipeline records them in `analysis/manifests/plugins.json`, but hook execution is a later implementation phase.

Useful outputs after `analyze`:

- `analysis/manifests/plugins.json`
- `analysis/manifests/entries.json`
- `analysis/graph/entry-dependencies.json`
- `analysis/graph/file-dependencies.json`
- `analysis/index/java/**/*.json`
- `analysis/index/jsp/**/*.json`
