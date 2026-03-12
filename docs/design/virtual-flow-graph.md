# Virtual Flow Graph Adaptation

## Target Model

The detailed design describes a broader logical graph with nodes such as:

- `ENTRY`
- `VIRTUAL_PAGE`
- `JSP`
- `JAVA_CLASS`
- `JAVA_METHOD`
- `DYNAMIC_CALL`
- `QUERY`
- `INTERFACE_SPEC`
- `TABLE`
- `EXTERNAL_SYSTEM`

## Current Implementation Boundary

The current LeflectJava graph is still centered on file-level relationships derived from:

- Java method-call summaries
- JSP scriptlet references
- JSP tag-handler usage

That produces:

- `analysis/graph/java-call.jsonl`
- `analysis/graph/jsp-java.jsonl`
- `analysis/graph/file-dependency.jsonl`
- `analysis/graph/file-dependencies.json`

## What Was Added Now

This adaptation adds the missing configuration and manifest pieces needed for the larger graph model:

- explicit entry declarations
- deferred query and interface targets
- plugin metadata and hook contracts
- stable source-relative seeds for future virtual-node expansion

## What Is Still Deferred

The following pieces remain future work by design:

- synthetic `DYNAMIC_CALL`, `QUERY`, and `INTERFACE_SPEC` nodes in the stored graph
- resolver-produced edges such as `JAVA_TO_QUERY_DYNAMIC`
- table and external-system expansion
- confidence and diagnostics that come from resolver matches instead of only static edges

The current repository therefore treats the new design as an incremental extension of the existing file graph, not as a replacement.
