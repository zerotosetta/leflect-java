# Config Guide

LeflectJava reads configuration from `leflect.config.json`.

Default location:

- `<source-root>/leflect.config.json`

You can also point the CLI to another file:

```bash
node bin/leflect analyze --root /path/to/repo --config /path/to/leflect.config.json
```

The config file can also be created with the wizard:

```bash
node bin/leflect init --root /path/to/repo
node bin/leflect init --root /path/to/repo --yes
```

## How Config Is Applied

- `root` is the repository being analyzed
- `analysisOut` defaults to `analysis`
- relative paths in the config file are resolved from `root`
- CLI options such as `--out`, `--analysis`, `--ignore-file`, `--labels-out` override config values
- `--jsp-ast-mode` overrides only the JSP AST mode
- if `java.workerJar` is omitted, the CLI still tries runtime auto-detection from:
  - `LEFLECT_JAVA_WORKER_JAR`
  - bundled NPX worker `java/leflectjava-java-worker-*.jar`
  - workspace build `java-worker/target/leflectjava-java-worker-*.jar`
- `--auto-system-classpath`, `--system-classpath-roots`, and `--system-classpath-max-retries`
  override `classpathDiscovery.*`

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
- `analysis/java-ast/` is not produced unless a Java worker JAR can be resolved
- `analysis/jsp-ast/` is also not produced unless `jsp.astMode=jasper` and a Java worker JAR can be resolved

## Init Wizard

`leflect init` writes `leflect.config.json` with either interactive prompts or detected defaults.

Useful commands:

```bash
node bin/leflect init --root /path/to/repo
node bin/leflect init --root /path/to/repo --yes
node bin/leflect init --root /path/to/repo --yes --force
```

The wizard detects:

- `.gitignore`
- common JSP web roots such as `src/main/webapp`
- `mvnw` or `pom.xml` for Maven classpath discovery defaults
- available Java worker JAR from config/env/bundled/workspace paths

The wizard can also write:

- `classpathDiscovery.enabled`, `classpathDiscovery.searchRoots`, `classpathDiscovery.maxRetries`
- `java.jreHome`, `java.javaHome`
- `java.classpath`, `jsp.classpath`
- `java.mavenCommand`, `jsp.mavenCommand`
- `entryFiles.java`, `entryFiles.jsp`

Supported init overrides:

- `--auto-system-classpath`
- `--system-classpath-roots`
- `--system-classpath-max-retries`
- `--worker-jar`
- `--jre-home`
- `--java-home`
- `--java-classpath`
- `--jsp-classpath`
- `--java-maven-command`
- `--jsp-maven-command`
- `--jsp-webapp-root`
- `--entry-java`
- `--entry-jsp`

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

### How Matching Works

- matching target is the source-relative path stored by LeflectJava
- path separator is normalized to `/`
- matching uses JavaScript regular expressions
- patterns are not glob syntax
- if you want an exact file match, anchor with `^` and `$`

Examples of actual match targets:

- `src/main/java/com/example/web/OrderController.java`
- `src/main/java/com/example/batch/NightlyJob.java`
- `src/main/webapp/WEB-INF/jsp/order/detail.jsp`
- `web/customerEdit.jsp`

### Pattern Examples

Match all controllers:

```json
{
  "entryFiles": {
    "java": [
      "Controller\\.java$"
    ]
  }
}
```

Match only files under a specific package path:

```json
{
  "entryFiles": {
    "java": [
      "^src/main/java/com/example/web/.+\\.java$"
    ]
  }
}
```

Match one exact JSP:

```json
{
  "entryFiles": {
    "jsp": [
      "^src/main/webapp/WEB-INF/jsp/order/detail\\.jsp$"
    ]
  }
}
```

Match all JSP views under `WEB-INF/jsp`:

```json
{
  "entryFiles": {
    "jsp": [
      "^src/main/webapp/WEB-INF/jsp/.+\\.jsp$"
    ]
  }
}
```

Mix Java and JSP entrypoints:

```json
{
  "entryFiles": {
    "java": [
      "Controller\\.java$",
      "Action\\.java$"
    ],
    "jsp": [
      "^src/main/webapp/WEB-INF/jsp/.+\\.jsp$",
      "^web/.+\\.jsp$"
    ]
  }
}
```

### Common Mistakes

- `*.jsp` 같은 glob 패턴을 쓰면 안 된다
  - `.+\\.jsp$` 또는 `^src/main/webapp/.+\\.jsp$`처럼 정규식을 써야 한다
- `.`을 그대로 쓰면 “아무 문자 1개”로 해석된다
  - 파일 확장자는 `\\.java`, `\\.jsp`처럼 escape 해야 한다
- path anchor를 안 쓰면 예상보다 많이 매칭될 수 있다
  - 예: `Service`는 경로 어디든 포함되면 다 매칭된다
- Windows 경로처럼 `\\` 구분자를 기대하면 안 된다
  - LeflectJava 내부 경로는 항상 `/`로 정규화된다

### Recommended Patterns

Legacy web MVC 프로젝트에서 시작점 후보를 빠르게 잡고 싶다면:

```json
{
  "entryFiles": {
    "java": [
      "Controller\\.java$",
      "Action\\.java$",
      "Servlet\\.java$"
    ],
    "jsp": [
      "^src/main/webapp/WEB-INF/jsp/.+\\.jsp$",
      "^web/.+\\.jsp$"
    ]
  }
}
```

### What To Check After Running

Entry 설정 후 `analyze` 또는 `build-graph`를 실행하면 아래 파일을 먼저 보면 된다.

- `analysis/graph/entry-dependencies.json`
  - `matchedEntries`: 실제로 어떤 파일이 entry로 선택되었는지
  - `unmatchedPatterns`: 아무 파일도 잡지 못한 패턴
  - `entries[*].reachableFiles`: 각 entry에서 도달 가능한 파일 목록
  - `entries[*].edges`: 각 entry의 dependency subgraph
- `analysis/graph/file-dependencies.json`
  - 각 `.java`/`.jsp` 파일의 `references`, `referencedBy`, `referenceCount`, `dependantCount`

만약 기대한 entry가 안 잡히면:

- `analysis/files/files.jsonl`에서 실제 source-relative path를 확인
- 그 경로 기준으로 정규식을 다시 맞추기
- `entry-dependencies.json`의 `unmatchedPatterns`를 확인

## Index Output Detail

`analysis/index/` now writes both aggregate files and per-source metadata files.

Java:

- `classes.json`, `methods.json`, `calls.json`
- `java-files.json`, `java-imports.json`, `java-classes.json`, `java-methods.json`, `java-calls.json`
- `java-class-references.json`, `java-method-calls.json`
- `java/**/*.json` for one metadata file per `.java`

JSP:

- `jsp-docs.json`
- `jsp-files.json`, `jsp-imports.json`, `jsp-taglibs.json`, `jsp-tags.json`, `jsp-scriptlets.json`
- `jsp-class-references.json`, `jsp-method-calls.json`
- `jsp/**/*.json` for one metadata file per `.jsp`

Reference/call records include `line`, `column`, `endLine`, `endColumn` when the parser can determine them.

## Full AST Config

Use this when you want both `.java` and `.jsp` files to produce 1:1 AST JSON files.

```json
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-*.jar",
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

## Auto System Classpath Discovery

Use this when the project depends on jars already present on the machine, but you do not want to
manually list every classpath entry up front.

```json
{
  "analysisOut": "./analysis",
  "classpathDiscovery": {
    "enabled": true,
    "maxRetries": 3
  },
  "jsp": {
    "webappRoot": "src/main/webapp"
  }
}
```

With this config:

- LeflectJava searches common system jar caches for missing Java classes and unresolved JSP taglib URIs
- JSP parse can retry automatically when Jasper reports `NoClassDefFoundError`, `ClassNotFoundException`, or unresolved taglib URIs
- Java parse can retry automatically when JavaParser SymbolSolver fails because support classes are missing
- default search roots are:
  - `~/.m2/repository`
  - `~/.gradle/caches/modules-2/files-2.1`
  - `~/.ivy2/cache`
  - `/usr/share/java`

If you want to pin the search roots:

```json
{
  "classpathDiscovery": {
    "enabled": true,
    "searchRoots": [
      "/Users/fortrit/.m2/repository",
      "/opt/company-jars"
    ],
    "maxRetries": 4
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

If Java is not on `PATH`, set either `java.jreHome` or `java.javaHome`:

```json
{
  "java": {
    "workerJar": "./java-worker/target/leflectjava-java-worker-*.jar",
    "jreHome": "/path/to/jre"
  }
}
```

`java.jreHome` is the explicit runtime setting. `java.javaHome` remains supported for existing
configs and can still point to a JDK or JRE. If both are set, `java.jreHome` wins.

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
    "workerJar": "./java-worker/target/leflectjava-java-worker-*.jar"
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

`classpathDiscovery.enabled`

- when `true`, LeflectJava searches system jar caches to augment classpath during analysis
- default: `false`

`classpathDiscovery.searchRoots`

- optional array of directories or `.jar` files to search when auto classpath discovery is enabled
- default roots:
  - `~/.m2/repository`
  - `~/.gradle/caches/modules-2/files-2.1`
  - `~/.ivy2/cache`
  - `/usr/share/java`

`classpathDiscovery.maxRetries`

- how many retry rounds LeflectJava performs after discovering additional jars from parse failures
- default: `3`

`entryFiles.java`

- optional array of regular expressions matched against source-relative `.java` paths
- use this to define Java entry files for entry-rooted dependency graph output

`entryFiles.jsp`

- optional array of regular expressions matched against source-relative `.jsp`/`.jspx` paths
- use this to define JSP entry files for entry-rooted dependency graph output

`java.workerJar`

- path to the Java worker shaded JAR
- if omitted, the CLI still tries env/bundled/workspace auto-detection
- still the most explicit option when you want a stable pinned worker path in config

`java.jreHome`

- optional JRE home used to launch the worker
- preferred when you want to pin a runtime without pointing at a full JDK
- if both `java.jreHome` and `java.javaHome` are set, `java.jreHome` takes precedence

`java.javaHome`

- optional JDK/JRE home used to launch the worker
- kept for backward compatibility and shared JDK/JRE installs

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

- set `java.workerJar` or make sure auto-detection can find a worker JAR
- if you want semantic resolution against external libraries, provide `java.classpath` and/or ensure Maven auto-discovery can run
- `methods.json`, `calls.json`, `java-class-references.json`, and `java-method-calls.json` become meaningfully populated only when `parse-java` runs

If you want `analysis/jsp-ast/`:

- keep `jsp.astMode` as `jasper`
- set `java.workerJar` or make sure auto-detection can find a worker JAR
- set `jsp.webappRoot` correctly for your project
- if your JSPs depend on external taglibs, provide `jsp.classpath` and/or ensure Maven
  auto-discovery can run
- or enable `classpathDiscovery.enabled` to let Jasper retry with jars discovered from system caches

If you only want report/index output:

- minimal config is enough

If you want entry-rooted dependency graphs and per-file dependants:

- set `entryFiles.java` and/or `entryFiles.jsp`
- inspect `analysis/graph/entry-dependencies.json`
- inspect `analysis/graph/file-dependencies.json`

## Common Problems

`java-ast/` is missing

- `java.workerJar` is not set and auto-detection also found no worker JAR
- `parse-java` did not run
- Java worker failed; check `analysis/logs/`

`methods.json` or `calls.json` is empty

- `parse-java` did not run, so only file-level Java inventory was available
- the analyzed Java files genuinely contain no method declarations or method calls

`reverse-index.json` or `taglibs.json` is emptier than expected

- source tree TLD files may be absent, but JSP directives should still populate URI/tag usage
- if even JSP directive/tag usage is missing, check `analysis/jsp-meta/` first

Java AST exists but semantic resolution is incomplete

- `java.classpath` is incomplete
- Maven auto-discovery could not run because no usable `mvn`/`mvnw` command was available
- the project depends on legacy repositories that Maven cannot resolve in the current environment
- enable `classpathDiscovery.enabled` if the missing jars already exist in system caches

`jsp-ast/` is missing

- `jsp.astMode` is set to `lightweight`
- `java.workerJar` is not set and auto-detection also found no worker JAR
- `jsp.webappRoot` is wrong for the target project
- Jasper could not resolve dependency-provided taglibs because `jsp.classpath` is incomplete
- Maven auto-discovery could not run because no usable `mvn`/`mvnw` command was available
- enable `classpathDiscovery.enabled` if the missing jars already exist in `~/.m2`, Gradle cache, or another local jar directory
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
    "workerJar": "./java-worker/target/leflectjava-java-worker-*.jar"
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
