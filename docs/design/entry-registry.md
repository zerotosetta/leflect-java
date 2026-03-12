# Entry Registry Adaptation

## Why This Exists

The legacy flow design starts from logical entries rather than from raw files. In practice that means:

- a business screen can fan out to multiple JSP fragments
- an entry can seed Java and JSP files together
- query IDs and interface identifiers may be declared up front even when the current graph cannot expand them yet

## Current LeflectJava Mapping

The current repository already had file-pattern entry selection through `entryFiles.java` and `entryFiles.jsp`.
This adaptation adds an explicit entry registry through `config.entries`.

Supported fields today:

- `id`
- `type`
- `label`
- `description`
- `jsp`
- `java`
- `query`
- `interfaceSpecs`
- `tags`
- `variants`

Entry `jsp` and `java` paths are normalized to source-relative keys because the graph layer works with the same keys as `analysis/index/*` and `analysis/graph/*`.

## Runtime Behavior

During `build-graph` the explicit entries are expanded into `analysis/graph/entry-dependencies.json`.
That output now contains two complementary sections:

- `entries`: regex-based entry file matches from `entryFiles`
- `declaredEntries`: explicit entry records from `config.entries`

Each declared entry record includes:

- normalized JSP and Java seeds
- whether each seed matched an indexed file
- deferred `query` and `interfaceSpecs` targets
- the reachable file subgraph from the matched JSP and Java seeds
- variant expansion through `variantOf`

## Deliberate Limits

The current graph builder is still file-oriented. That means:

- `query` and `interfaceSpecs` are recorded but not traversed yet
- no synthetic `ENTRY` or `VIRTUAL_PAGE` nodes are injected into the graph storage yet
- multi-entry depth reconciliation is deferred to the depth/grouping phase

This keeps the current outputs stable while making the entry model explicit and testable.
