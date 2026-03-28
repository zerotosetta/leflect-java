# Kuali KFS Sample

This example prepares the public repository
`https://github.com/kuali/kfs`
for LeflectJava testing.

## Why This Sample

- large legacy Maven multi-module codebase
- `kfs-web` WAR module with JSP, tag files, and local TLDs
- more than 5,700 Java files and 140+ JSP screens
- realistic legacy dependency graph for dashboard and analysis stress testing

## What The Scripts Do

`fetch.sh`

- shallow-clones `kuali/kfs` into `.examples/kuali-kfs-master`
- writes a module-targeted Maven wrapper at `.leflect/mvn-kfs-web.sh`
- writes `leflect.config.ts` into the cloned sample root
- enables `classpathDiscovery` with a higher retry budget for old Maven dependencies
- defaults to `jsp.astMode=jasper` when a local Java worker JAR exists, otherwise downgrades to `lightweight`
- declares three representative virtual-page entries and matches all KFS JSP screens under `kfs-web/src/main/webapp/jsp`

`run.sh`

- runs `pnpm build` for LeflectJava
- fetches or refreshes the sample
- runs `node bin/leflect analyze --config <sample>/leflect.config.ts --incremental`
- prints `report summary`, one `query jsp-impact` example, and a declared-entry summary

## Usage

```bash
pnpm example:kuali-kfs:fetch
pnpm example:kuali-kfs:run
pnpm dashboard:dev:kuali-kfs
```

You can override the clone location:

```bash
bash examples/kuali-kfs/run.sh /absolute/path/to/kfs-sample
```

Dashboard:

```bash
node bin/leflect dashboard-dev \
  --root .examples/kuali-kfs-master \
  --config .examples/kuali-kfs-master/leflect.config.ts
```

## Notes

- The repo does not ship a Maven wrapper, so the generated wrapper script calls `mvn -pl kfs-web -am ...`.
- If `mvn` is not on `PATH`, export `LEFLECT_KFS_MAVEN_EXECUTABLE` with the Maven executable path before running `fetch.sh` or `run.sh`.
- If you need to pin extra jars or directories, export `LEFLECT_JAVA_CLASSPATH` and/or `LEFLECT_JSP_CLASSPATH` as OS path-separated lists before running `fetch.sh`.
- If you want to override the classpath discovery search roots, export `LEFLECT_KFS_SEARCH_ROOTS`.
- Initial analysis on KFS can take noticeably longer than the bundled samples because of project size.
