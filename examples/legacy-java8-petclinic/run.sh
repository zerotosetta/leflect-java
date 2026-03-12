#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_TAG=${PETCLINIC_GIT_TAG:-v5.0.8}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/spring-framework-petclinic-$SAMPLE_TAG"}
CONFIG_PATH="$TARGET_DIR/leflect.config.ts"
QUERY_FILE=${QUERY_FILE:-src/main/webapp/WEB-INF/jsp/legacy/virtualOwnerConsole.jsp}
ENTRY_ID=${ENTRY_ID:-legacy.owner.console}

bash "$SCRIPT_DIR/fetch.sh" "$TARGET_DIR"

cd "$REPO_ROOT"
pnpm build

echo
echo "Running analyze for sample: $TARGET_DIR"
node bin/leflect analyze --root "$TARGET_DIR" --config "$CONFIG_PATH"

echo
echo "Summary report"
node bin/leflect report summary --root "$TARGET_DIR" --config "$CONFIG_PATH"

echo
echo "JSP impact query: $QUERY_FILE"
node bin/leflect query jsp-impact --root "$TARGET_DIR" --config "$CONFIG_PATH" --file "$QUERY_FILE"

echo
echo "Declared entry summary: $ENTRY_ID"
python3 - <<'PY' "$TARGET_DIR/analysis/graph/entry-dependencies.json" "$ENTRY_ID"
import collections
import json
import sys
from pathlib import Path

entry_index_path = Path(sys.argv[1])
entry_id = sys.argv[2]
entry_index = json.loads(entry_index_path.read_text(encoding="utf-8"))
record = next(
    (item for item in entry_index.get("declaredEntries", []) if item.get("id") == entry_id),
    None,
)

if record is None:
    raise SystemExit(f"Declared entry not found: {entry_id}")

seed_paths = [
    seed["path"]
    for group in record["seeds"].values()
    for seed in group
    if seed.get("matched") and seed.get("path")
]
adjacency = collections.defaultdict(list)
for edge in record.get("edges", []):
    adjacency[edge["from"]].append(edge["to"])

queue = collections.deque((seed, 0) for seed in seed_paths)
depths = {}
while queue:
    node, depth = queue.popleft()
    if node in depths and depths[node] <= depth:
        continue
    depths[node] = depth
    for target in adjacency.get(node, []):
        queue.append((target, depth + 1))

farthest_path, farthest_depth = max(depths.items(), key=lambda item: item[1]) if depths else ("", 0)
print(
    json.dumps(
        {
            "id": record["id"],
            "nodeCount": record["nodeCount"],
            "edgeCount": record["edgeCount"],
            "seedPaths": seed_paths,
            "maxDepth": farthest_depth,
            "farthestPath": farthest_path,
        },
        indent=2,
    )
)
PY

echo
echo "Artifacts:"
echo "  $TARGET_DIR/analysis/report/summary.json"
echo "  $TARGET_DIR/analysis/report/unresolved.json"
echo "  $TARGET_DIR/analysis/report/impact.md"
echo "  $TARGET_DIR/analysis/graph/entry-dependencies.json"
