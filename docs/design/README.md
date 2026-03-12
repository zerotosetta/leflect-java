# Design Adaptation Index

These notes translate the added legacy flow design memos into the current LeflectJava codebase.
They are intentionally split by feature so each document maps to one implementation track.

- `entry-registry.md`: explicit entry definitions, virtual-page fan-out, and declared entry outputs
- `plugin-hooks.md`: TypeScript config loading, plugin factories, public hook API, and plugin manifests
- `virtual-flow-graph.md`: how the current file graph maps to the larger legacy dependency model
- `depth-grouping.md`: planned depth and grouping work, with the current graph outputs as the foundation
- `sample-migration.md`: migration guidance and the runnable TypeScript-config sample project
