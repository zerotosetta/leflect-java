# Legacy Java 8 Sample

This example uses the public repository
`https://github.com/spring-petclinic/spring-framework-petclinic`
at tag `v5.0.8`.

## Why This Sample

- `pom.xml` declares `java.version` as `1.8`
- the project is packaged as a WAR
- JSP views live under `src/main/webapp/WEB-INF/jsp`
- the views use Spring/JSTL taglibs and fit the legacy Java/JSP target

## What The Scripts Do

`fetch.sh`

- shallow-clones the upstream sample into `.examples/spring-framework-petclinic-v5.0.8`
- writes `leflect.config.json` into the cloned sample root
- if a local worker JAR already exists at `java-worker/target/leflectjava-java-worker-*.jar`,
  it auto-enables full Java/JSP AST extraction
- if common Spring/JSTL jars already exist in `~/.m2/repository`, it auto-writes them into
  `java.classpath` and `jsp.classpath`
- the default classpath now includes the Spring MVC support jars needed for form-tag JSPs,
  not just `spring-webmvc`
- keeps analysis output inside the sample at `analysis/`

`run.sh`

- runs `pnpm build` for LeflectJava
- fetches the sample if needed
- runs `node bin/leflect analyze --config <sample>/leflect.config.json --incremental`
- prints `report summary` and one `query jsp-impact` example

## Usage

```bash
pnpm example:legacy-java8:fetch
pnpm example:legacy-java8:run
```

You can override the default clone location:

```bash
bash examples/legacy-java8-petclinic/run.sh /absolute/path/to/sample
```

## Notes

- If the local worker JAR exists, `fetch.sh` now writes a full-analysis config by default.
- The sample does not ship `.tld` files in source control, so full JSP AST generation still
  depends on dependency-provided Spring/JSTL jars being visible. `fetch.sh` auto-detects the
  common jars from `~/.m2/repository`, including the Spring support jars required by
  `form:` tag handling, and you can still override them explicitly.
- If you want to pin a different Java worker JAR, export `LEFLECT_JAVA_WORKER_JAR` before
  running `fetch.sh` or `run.sh`.
- If `mvn` is not on `PATH`, export `LEFLECT_JSP_MAVEN_COMMAND` with an absolute
  Maven executable path so LeflectJava can auto-resolve JSP dependency classpath
  for Jasper.
- If Java semantic resolution also needs Maven classpath discovery, export
  `LEFLECT_JAVA_MAVEN_COMMAND` in the same way.
- If the sample's own Maven dependency graph cannot be resolved cleanly, export
  `LEFLECT_JSP_CLASSPATH` as an OS path-separated list of JARs/directories and
  `fetch.sh` will write them into `jsp.classpath`.
- You can do the same for Java analysis with `LEFLECT_JAVA_CLASSPATH`.
- Without a Java worker JAR, the example pins `jsp.astMode` to `lightweight` so the
  sample remains runnable. You can override this with `LEFLECT_JSP_AST_MODE=jasper`.
