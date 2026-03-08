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

- The sample does not ship `.tld` files in source control, so dependency-provided
  Spring taglibs remain unresolved in the current lightweight run.
- If you have a built Java worker JAR, export `LEFLECT_JAVA_WORKER_JAR` before
  running `fetch.sh` or `run.sh`. The generated `leflect.config.json` will include
  the Java worker settings and `analyze` will execute `parse-java`.
