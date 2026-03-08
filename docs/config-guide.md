# Config Guide

LeflectJava reads configuration from `leflect.config.json`.

Default location:

- `<source-root>/leflect.config.json`

You can also point the CLI to another file:

```bash
node bin/leflect analyze --root /path/to/repo --config /path/to/leflect.config.json
```

## How Config Is Applied

- `root` is the repository being analyzed
- `analysisOut` defaults to `analysis`
- relative paths in the config file are resolved from `root`
- CLI options such as `--out`, `--analysis`, `--ignore-file`, `--labels-out` override config values
- `--jsp-ast-mode` overrides only the JSP AST mode

## Minimal Config

This is enough to run scan, TLD parsing, JSP metadata, index, graph, and report output.

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore"
}
```

With this config:

- `analysis/files/`, `analysis/manifests/`, `analysis/jsp-meta/`, `analysis/index/`, `analysis/graph/`, `analysis/report/` are produced
- `analysis/java-ast/` is not produced because no Java worker is configured
- `analysis/jsp-ast/` is also not produced because `jsp.astMode` defaults to `jasper` but Jasper execution still requires `java.workerJar`

## Full AST Config

Use this when you want both `.java` and `.jsp` files to produce 1:1 AST JSON files.

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-0.1.0.jar"
  },
  "jsp": {
    "webappRoot": "src/main/webapp"
  }
}
```

With this config:

- `.java` files produce full AST JSON under `analysis/java-ast/**/*.json`
- `.jsp` files produce full AST JSON under `analysis/jsp-ast/**/*.json`
- JSP conversion also emits generated servlet source under `analysis/generated-jsp-java/`

If Java is not on `PATH`, set `java.javaHome`:

```json
{
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-0.1.0.jar",
    "javaHome": "/path/to/jdk"
  }
}
```

## Lightweight JSP Config

Use this if you want JSP metadata only and do not want Jasper-based AST generation.

```json
{
  "analysisOut": "./analysis",
  "jsp": {
    "astMode": "lightweight"
  }
}
```

With this config:

- `analysis/jsp-meta/` is produced
- `analysis/jsp-ast/` is not produced

## Legacy WAR / JSP Project Config

Typical setup for a legacy Java web application:

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "labelsOut": "./analysis/index/labels.json",
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-0.1.0.jar"
  },
  "jsp": {
    "webappRoot": "src/main/webapp",
    "generatedJavaOut": "./analysis/generated-jsp-java",
    "astOut": "./analysis/jsp-ast"
  }
}
```

This is the most explicit form and is useful when you want all output paths pinned in the config file.

## Field Reference

`analysisOut`

- analysis output root
- default: `analysis`

`ignoreFile`

- ignore rules file in `.gitignore` syntax
- example: `.gitignore` or `.leflectignore`

`labelsOut`

- output path for `labels.json`
- default: `<analysisOut>/index/labels.json`

`java.workerJar`

- path to the Java worker shaded JAR
- required for `parse-java`
- required for `parse-jsp` when `jsp.astMode = "jasper"`

`java.javaHome`

- optional JDK/JRE home used to launch the worker

`jsp.astMode`

- allowed values: `jasper`, `lightweight`
- default: `jasper`
- `jasper`: generate full JSP AST JSON through `JSP -> Jasper -> JavaParser`
- `lightweight`: skip JSP AST generation and write JSP metadata only

`jsp.webappRoot`

- web application root used by Jasper
- usually `src/main/webapp` for WAR projects

`jsp.generatedJavaOut`

- optional output directory for Jasper-generated servlet Java files
- default: `<analysisOut>/generated-jsp-java`

`jsp.astOut`

- optional output directory for JSP AST JSON
- default: `<analysisOut>/jsp-ast`

## Output Expectations

If you want `analysis/java-ast/`:

- set `java.workerJar`

If you want `analysis/jsp-ast/`:

- keep `jsp.astMode` as `jasper`
- set `java.workerJar`
- set `jsp.webappRoot` correctly for your project

If you only want report/index output:

- minimal config is enough

## Common Problems

`java-ast/` is missing

- `java.workerJar` is not set
- `parse-java` did not run
- Java worker failed; check `analysis/logs/`

`jsp-ast/` is missing

- `jsp.astMode` is set to `lightweight`
- `java.workerJar` is not set
- `jsp.webappRoot` is wrong for the target project
- Jasper compilation failed; check `analysis/logs/`

`analysis/report/unresolved.json` is where you want detailed failure context

- `diagnostics[]` gives a flat list of issues with `path`, `category`, `summary`, `message`, and optional `hint`
- parse-stage diagnostics also include `location.line`, `location.column`, `location.endLine`, `location.endColumn`, and `snippet` when the worker can resolve them
- `byPath[]` groups the same diagnostics by source file so you can review a problematic JSP or Java file in one place
- `analysis/logs/java-parse-errors.jsonl` and `analysis/logs/jsp-parse-errors.jsonl` contain the raw per-stage records in JSONL form

`labels.json` is not where expected

- `labelsOut` was overridden by CLI `--labels-out`
- otherwise the default path is `<analysisOut>/index/labels.json`

## Recommended Start

For most real Java/JSP repositories, start with:

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-0.1.0.jar"
  },
  "jsp": {
    "webappRoot": "src/main/webapp"
  }
}
```

Then run:

```bash
node bin/leflect analyze --root /path/to/repo --config /path/to/repo/leflect.config.json --incremental
```
