# Migration Notes And Sample Project

## Recommended Adoption Order

1. Move repository-specific assembly into `leflect.config.ts`
2. Declare stable virtual-page entries under `entries`
3. Keep using the current Java/JSP indexers and file graph as the first source of truth
4. Add plugin factories for dynamic query or interface patterns
5. Wire hook execution only after the plugin contracts and manifests are stable

## Runnable Sample

The repository now includes `examples/ts-config-account-flow`.

It demonstrates:

- `leflect.config.ts`
- local plugin imports
- explicit entries with fan-out and variants
- deferred query and interface targets
- existing file-pattern entry matching

Run it with:

```bash
pnpm example:ts-config:run
```

Inspect these outputs first:

- `analysis/manifests/plugins.json`
- `analysis/manifests/entries.json`
- `analysis/graph/entry-dependencies.json`

## Why The Sample Uses Lightweight JSP Parsing

The sample keeps `jsp.astMode = "lightweight"` so it does not depend on compiled project classes for Jasper.
That keeps the example runnable while still exercising:

- the TypeScript config loader
- plugin loading
- Java AST export when a worker is available
- JSP metadata, index, and graph generation
