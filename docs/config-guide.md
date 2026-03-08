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

## Entry File Dependency Config

Use this when you want LeflectJava to treat selected `.java`/`.jsp` files as dependency
entrypoints and emit entry-rooted graph slices.

```json
{
  "analysisOut": "./analysis",
  "entryFiles": {
    "java": [
      "Controller\\.java$",
      "Action\\.java$"
    ],
    "jsp": [
      "WEB-INF/jsp/.+\\.jsp$"
    ]
  }
}
```

With this config:

- patterns are regular expressions applied to source-relative file paths
- `analysis/graph/entry-dependencies.json` contains the matched entry files and the reachable dependency graph for each entry
- `analysis/graph/file-dependencies.json` contains per-file `references`, `referencedBy`, `referenceCount`, and `dependantCount`
- unmatched patterns are also recorded so you can see when a config pattern selected nothing

## Full AST Config

Use this when you want both `.java` and `.jsp` files to produce 1:1 AST JSON files.

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-0.1.0.jar",
    "classpath": [
      "./target/classes",
      "./lib/external-support.jar"
    ]
  },
  "jsp": {
    "webappRoot": "src/main/webapp",
    "classpath": [
      "./lib/custom-taglibs.jar"
    ]
  }
}
```

With this config:

- `.java` files produce full AST JSON under `analysis/java-ast/**/*.json`
- Java semantic resolution can use `java.classpath` and Maven auto-discovery
- `.jsp` files produce full AST JSON under `analysis/jsp-ast/**/*.json`
- JSP conversion also emits generated servlet source under `analysis/generated-jsp-java/`
- Jasper resolves taglib dependencies from `jsp.classpath` and, when `pom.xml` is present,
  also tries Maven dependency classpath auto-discovery

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

`entryFiles.java`

- optional array of regular expressions matched against source-relative `.java` paths
- use this to define Java entry files for entry-rooted dependency graph output

`entryFiles.jsp`

- optional array of regular expressions matched against source-relative `.jsp`/`.jspx` paths
- use this to define JSP entry files for entry-rooted dependency graph output

`java.workerJar`

- path to the Java worker shaded JAR
- required for `parse-java`
- required for `parse-jsp` when `jsp.astMode = "jasper"`

`java.javaHome`

- optional JDK/JRE home used to launch the worker

`java.classpath`

- optional array of JAR/directories used by JavaParser SymbolSolver
- use this for external libraries or precompiled project classes when Java semantic resolution matters

`java.mavenCommand`

- optional Maven executable path or command name used for Java dependency classpath auto-discovery
- default behavior:
  - use `./mvnw` when present
  - otherwise try `mvn`

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

`jsp.classpath`

- optional array of JAR/directories to append to Jasper classpath
- use this when taglibs or generated classes are outside the webapp source tree

`jsp.mavenCommand`

- optional Maven executable path or command name used for JSP dependency classpath auto-discovery
- default behavior:
  - use `./mvnw` when present
  - otherwise try `mvn`
- some legacy projects fail Maven classpath resolution because their dependency graph still points
  at blocked HTTP repositories; in that case, use `jsp.classpath` explicitly

## Output Expectations

If you want `analysis/java-ast/`:

- set `java.workerJar`
- if you want semantic resolution against external libraries, provide `java.classpath` and/or ensure Maven auto-discovery can run

If you want `analysis/jsp-ast/`:

- keep `jsp.astMode` as `jasper`
- set `java.workerJar`
- set `jsp.webappRoot` correctly for your project
- if your JSPs depend on external taglibs, provide `jsp.classpath` and/or ensure Maven
  auto-discovery can run

If you only want report/index output:

- minimal config is enough

If you want entry-rooted dependency graphs and per-file dependants:

- set `entryFiles.java` and/or `entryFiles.jsp`
- inspect `analysis/graph/entry-dependencies.json`
- inspect `analysis/graph/file-dependencies.json`

## Common Problems

`java-ast/` is missing

- `java.workerJar` is not set
- `parse-java` did not run
- Java worker failed; check `analysis/logs/`

Java AST exists but semantic resolution is incomplete

- `java.classpath` is incomplete
- Maven auto-discovery could not run because no usable `mvn`/`mvnw` command was available
- the project depends on legacy repositories that Maven cannot resolve in the current environment

`jsp-ast/` is missing

- `jsp.astMode` is set to `lightweight`
- `java.workerJar` is not set
- `jsp.webappRoot` is wrong for the target project
- Jasper could not resolve dependency-provided taglibs because `jsp.classpath` is incomplete
- Maven auto-discovery could not run because no usable `mvn`/`mvnw` command was available
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
