# Depth And Grouping Plan

## Why Depth Is Separate

The detailed design is correct to keep depth calculation after graph construction.
The current repository already emits stable file-level edges, which is the right prerequisite for depth work.

## Current State

Today LeflectJava provides:

- file dependency edges
- per-file reference and dependant summaries
- entry-rooted reachable file sets for both regex and declared entries

Those outputs are enough to introduce depth as a pure graph post-process later.

## Planned Follow-Up

A future depth module should:

- compute the shortest distance from each declared entry seed set
- preserve per-entry depth when multiple entries reach the same file
- retain unresolved and deferred dynamic targets without collapsing them away
- emit grouping records that the dashboard and projection UI can consume without rendering the full graph at once

## Recommended Storage Shape

When depth is added, keep it in a dedicated artifact instead of rewriting the existing file graph:

- `analysis/graph/depth-index.json`
- `analysis/graph/group-index.json`

That keeps backward compatibility with current tooling and avoids forcing the dashboard onto one graph representation.
