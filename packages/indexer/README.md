# @leflect-java/indexer

`@leflect-java/indexer` turns parsed Java/JSP artifacts into sharded index files for downstream tooling.

Use this package when you want:

- programmatic access to Java/JSP index builders
- sharded metadata under `analysis/index/java/**/*.json` and `analysis/index/jsp/**/*.json`
- field/class/method/call metadata without reading full AST JSON

## Expected Inputs

Typical pipeline inputs are:

- Java summaries from `analysis/index/java-summary.jsonl`
- JSP metadata from `analysis/jsp-meta/**/*.json`
- raw TLD registry from `analysis/index/taglib-registry.json`
- file manifests from `analysis/manifests/java-files.json` and `analysis/manifests/tld-files.json`

## Programmatic Usage

```ts
import {
  buildJavaIndex,
  buildJspSemanticAsts,
  buildJspIndex,
  readJavaSummaryIndex,
  writeJavaIndex
} from "@leflect-java/indexer";

const summaries = await readJavaSummaryIndex("/repo/analysis/index/java-summary.jsonl");
const javaIndex = buildJavaIndex({
  files: ["src/main/java/demo/App.java"],
  summaries
});

await writeJavaIndex("/repo/analysis/index", javaIndex);
```

If you are building JSP semantic output programmatically, `buildJspSemanticAsts(...)` consumes
JSP document metadata plus the raw TLD registry and produces one semantic AST per JSP source.

## Java Metadata

Java file metadata now includes:

- `fields[]` for declaration-level field metadata
- `methods[].orderedSteps[]` for ordered method-body flow
- additive normalized aliases such as `type`, `targetText`, `resolvedClassId`, `resolvedMethodId`, and `lineRange`

### Fields

Each field record includes:

- `id`
- `name`
- `classId`
- `file`
- `declaredType`
- `type`
- `modifiers`
- `lifetime`
- `initializerSnippet`
- `location`
- `lineRange`

`declaredType` is kept for compatibility. `type` is the normalized alias to prefer in new integrations.

`lifetime` is `"class"` for `static` fields and `"instance"` otherwise.

### Ordered Execution Steps

Each method record can include `orderedSteps[]` with entries shaped like:

- `id`
- `kind`
- `snippet`
- `branchPath`
- `lineRange`
- `call`

`call` is present for call-like steps and includes:

- `targetText`
- `resolvedMethodId`
- `resolvedClassId`
- `methodName`

This is intended for workflow reconstruction and machine consumers that need method-internal order without re-reading full AST JSON.

`analysis/index/java-files.json` also includes `fieldCount` for each Java source file.

## Output Layout

- `java-files.json`: manifest with `metadataPath`, `classCount`, `fieldCount`, `methodCount`, `callCount`
- `java/**/*.json`: per-file metadata with `imports`, `classes`, `fields`, `methods`, `calls`, `classReferences`
  - `fields[]` carries field declaration metadata and initializer snippets
  - `methods[]` carries `orderedSteps[]` plus normalized `lineRange`
  - `calls[]` keeps legacy `rawTarget` and also includes normalized `targetText`, `resolvedClassId`, and `resolvedMethodId`
- `jsp-files.json`: per-file JSP manifest with `semanticAstPath` and semantic summary counts
- `jsp/**/*.json`: per-file JSP metadata with structural `document`, `semanticAstPath`, and `semanticSummary`
- `../jsp-semantic/**/*.json`: full semantic JSP AST files
- `taglib-registry.json`: canonical raw TLD registry with tag schema, handler class, source path, and source kind
- `reverse-index.json` and `taglibs.json`: lookup-oriented artifacts for integrations

### JSP Semantic Metadata

JSP semantic AST files are designed for TLD-aware workflow extraction without reparsing JSP or TLD input.

Current built-in mappings include:

- `c:if` -> `IfStatement`
- `c:choose` -> `ChooseStatement`
- `c:when` -> `WhenBranch`
- `c:otherwise` -> `OtherwiseBranch`
- `c:forEach` -> `LoopNode`
- `sql:query` and `sql:update` -> `QueryNode`

Custom mappings can be injected via `jsp.taglibResolvers` in `leflect.config.ts`.

## Related Packages

- [`@leflect-java/cli`](../cli/README.md): high-level orchestration and public integration API
- [`@leflect-java/java-bridge`](../java-bridge/README.md): produces the Java summary input consumed here
