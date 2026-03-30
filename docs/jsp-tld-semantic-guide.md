# JSP + TLD Semantic AST Guide

This guide covers the new JSP semantic AST flow in LeflectJava:

1. `parse-tld` collects raw tag library descriptors into `analysis/index/taglib-registry.json`
2. `parse-jsp` writes flat JSP metadata plus a nested structural `document` tree under `analysis/jsp-meta/**/*.json`
3. `build-index` combines the JSP document, TLD registry, and resolver config to produce:
   - `analysis/jsp-semantic/**/*.json`
   - additive semantic fields in `analysis/index/jsp/**/*.json`
   - manifest-level semantic summaries in `analysis/index/jsp-files.json`

## When To Use It

Use semantic JSP output when you need:

- ordered, nested JSP structure instead of only flat tag/scriptlet metadata
- TLD-aware tag meaning without reparsing `.tld` or `.jar` files yourself
- reimplementation or workflow extraction that can consume `IfStatement`, `LoopNode`, `QueryNode`, and `CustomTagNode`
- EL parsing that preserves both normalized structure and raw source text

## Config Example

```ts
import { defineConfig } from "@leflect-java/core";

export default defineConfig({
  analysisOut: "./analysis",
  jsp: {
    webappRoot: "src/main/webapp",
    astMode: "lightweight",
    semanticAstOut: "./analysis/jsp-semantic",
    classpath: ["./target/classes", "./lib/custom-tags.jar"],
    tld: {
      autoLoad: true,
      paths: ["./src/main/webapp/WEB-INF", "./lib/custom-tags.jar"],
      uriMap: {
        "http://java.sun.com/jsp/jstl/core": "./tld/c.tld",
        "/WEB-INF/form.tld": "./src/main/webapp/WEB-INF/form.tld"
      }
    },
    taglibResolvers: {
      "/WEB-INF/form.tld#query": ({ node }) => ({
        kind: "QueryNode",
        queryId: node.attributes.id?.value,
        statement: node.attributes.sql?.value,
        parameters: [],
        dataSource: node.attributes.dataSource?.value,
        sourceTag: `${node.prefix}:${node.name}`,
        lineRange: node.lineRange
      })
    }
  }
});
```

Resolver matching order is fixed:

1. `uri#tagName`
2. `prefix:tagName`
3. built-in resolver
4. generic `CustomTagNode`

If a custom resolver throws or returns `undefined`, LeflectJava records a diagnostic and falls back to `CustomTagNode`.

## Built-In Tag Semantics

Built-in semantic nodes currently cover:

- JSTL core
  - `c:if` -> `IfStatement`
  - `c:choose` -> `ChooseStatement`
  - `c:when` -> `WhenBranch`
  - `c:otherwise` -> `OtherwiseBranch`
  - `c:forEach` -> `LoopNode`
- JSTL SQL
  - `sql:query` -> `QueryNode`
  - `sql:update` -> `QueryNode`

Everything else falls back to `CustomTagNode` unless you provide a resolver.

## Structural JSP Document

`parse-jsp` now writes a nested `document` tree alongside the existing flat metadata.

Supported structural node kinds:

- `Document`
- `Text`
- `HtmlElement`
- `CustomTagElement`
- `Directive`
- `IncludeDirective`
- `Scriptlet`
- `Expression`
- `Declaration`
- `ElExpression`

Each node keeps:

- `kind`
- `raw`
- `lineRange`
- `children` when applicable

Include behavior is intentionally conservative in v1:

- include directives and include tags remain reference nodes
- LeflectJava does not inline or merge transitive include trees yet

## EL Parsing

EL expressions are parsed aggressively, but never at the expense of pipeline stability.

Supported expression shapes include:

- property access
- array and map indexing
- namespaced function calls such as `fn:length(items)`
- unary operators such as `!`, `empty`, unary `-`
- binary comparison and arithmetic
- logical `&&` and `||`
- ternary `?:`
- string, number, boolean, and `null` literals

Every EL node keeps `raw`. If parsing fails, the result degrades to a raw or unknown expression node and the rest of the JSP still indexes normally.

## Output Walkthrough

### `analysis/index/taglib-registry.json`

This is the canonical raw TLD registry collected by `parse-tld`.

Use it when you need:

- tag attribute schema
- handler class
- `bodyContent`
- `dynamicAttributes`
- raw source provenance such as `sourcePath` and `sourceKind`

The registry precedence is:

1. `jsp.tld.uriMap`
2. repo-discovered `.tld`
3. `jsp.tld.paths` in listed order
4. classpath and auto-loaded jar sources

### `analysis/index/taglibs.json`

This is the final usage-oriented taglib index written by `build-index`.

Use it when you need:

- which JSP files referenced each taglib
- additive schema details copied from the registry
- a lookup summary instead of raw source descriptors

### `analysis/jsp-semantic/**/*.json`

Each JSP source now gets a semantic AST file. The root shape is:

- `schemaVersion`
- `generatedAt`
- `path`
- `astMode`
- `semanticSummary`
- `root`
- `diagnostics`

Typical semantic nodes include:

- `TextNode`
- `ElExpressionNode`
- `IfStatement`
- `ChooseStatement`
- `WhenBranch`
- `OtherwiseBranch`
- `LoopNode`
- `QueryNode`
- `CustomTagNode`
- `ScriptletNode`
- `ExpressionNode`
- `DeclarationNode`

### `analysis/index/jsp-files.json`

This manifest now includes:

- `semanticAstPath`
- `semanticNodeCount`
- `semanticControlCount`
- `semanticQueryCount`
- `semanticCustomTagCount`
- `semanticDiagnosticCount`

That gives machine consumers a cheap discovery layer before loading full semantic files.

## Custom Resolver Example

```ts
import { defineConfig } from "@leflect-java/core";

export default defineConfig({
  jsp: {
    taglibResolvers: {
      "/WEB-INF/my-query.tld#query": ({ node, parseAttributeEl }) => ({
        kind: "QueryNode",
        queryId: node.attributes.id?.value,
        statement: node.attributes.sql?.value,
        parameters: node.attributes.param
          ? [parseAttributeEl(node.attributes.param.value)]
          : [],
        dataSource: node.attributes.dataSource?.value,
        sourceTag: `${node.prefix}:${node.name}`,
        lineRange: node.lineRange
      })
    }
  }
});
```

Resolver context gives you:

- the normalized tag node
- the resolved TLD registry entry and tag schema, when available
- `parseEl(...)` and `parseAttributeEl(...)`
- the source file path
- the project root

Keep resolvers additive and deterministic. They should translate a tag into a semantic node, not try to perform graph writes or IO.

## Troubleshooting

### A tag library URI resolves to the wrong `.tld`

- Add an explicit `jsp.tld.uriMap` entry
- Check `analysis/index/taglib-registry.json` to confirm which source won
- Inspect diagnostics from `parse-tld` for duplicate URI warnings

### A custom resolver is not firing

- Prefer `uri#tagName` over `prefix:tagName` when you know the real URI
- Confirm the taglib declaration is present in the JSP metadata
- Inspect `analysis/jsp-semantic/**/*.json` diagnostics for resolver errors or fallbacks

### EL parsing is incomplete

- Check the `raw` field first
- Expect fallback nodes for malformed or non-standard EL syntax
- If you need project-specific coercion or bean resolution, add it on top of the emitted EL AST

### The semantic AST is missing even though `parse-jsp` ran

- Run `build-index`; semantic AST emission happens there, not in `parse-jsp`
- Confirm `analysis/index/taglib-registry.json` exists or `analysis/index/taglibs.json` is present as a fallback
- Check `analysis/index/jsp-files.json` for `semanticAstPath` and diagnostic counts

## Recommended Consumption Pattern

For downstream tools:

1. start with `analysis/index/jsp-files.json`
2. load only the JSP files whose semantic summary matches your target workflow
3. read the corresponding `analysis/jsp-semantic/**/*.json`
4. use `analysis/index/taglib-registry.json` only when you need raw tag schema or source provenance

That keeps integrations fast and avoids reparsing JSP, EL, or TLD content in the consumer.
