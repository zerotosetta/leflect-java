# Plugin And Hook Adaptation

## Goal

The added TypeScript design memo separates project-specific dynamic resolution from the core analyzers.
The adapted implementation keeps that separation and introduces a stable public API before wiring full runtime execution.

## Public API

The public plugin surface now lives in `@leflect-java/schema` and is re-exported by `@leflect-java/core`.
Key types:

- `LeflectPlugin`
- `AnalyzerHookDefinition`
- `HookResolveResult`
- `NormalizedNodeInput`
- `NormalizedEdgeInput`

The API is intentionally narrow:

- plugins expose metadata, setup/dispose hooks, and analyzer hooks
- hooks inspect a stable `PublicAstNode` contract instead of internal parser objects
- hooks return normalized nodes and edges instead of mutating graph storage directly

## Config Loading

The repository now supports these config entry points:

- `leflect.config.ts`
- `leflect.config.mjs`
- `leflect.config.js`
- `leflect.config.cjs`
- `leflect.config.json`

`leflect.config.ts` is bundled with esbuild during loading so local TypeScript plugin modules can be imported directly.
Relative plugin imports are bundled; package imports stay external.

## Current Runtime Scope

Plugins are currently loaded, ordered, validated, and emitted to `analysis/manifests/plugins.json`.
That gives the pipeline:

- a stable TypeScript assembly point through `defineConfig(...)`
- deterministic plugin ordering via `enforce`
- a visible manifest for debugging and sample projects

Hook execution is intentionally not active yet. The next implementation phase will connect the hook dispatcher to Java/JSP analyzer events and feed normalized results into the graph builder.
