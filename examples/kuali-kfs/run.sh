#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_REF=${KFS_GIT_REF:-master}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/kuali-kfs-$SAMPLE_REF"}
CONFIG_PATH="$TARGET_DIR/leflect.config.ts"
QUERY_FILE=${QUERY_FILE:-kfs-web/src/main/webapp/jsp/fp/DisbursementVoucher.jsp}
ENTRY_ID=${ENTRY_ID:-kfs.fp.disbursement-voucher}

if [ $# -gt 0 ]; then
  shift
fi

bash "$SCRIPT_DIR/fetch.sh" "$TARGET_DIR"

cd "$REPO_ROOT"
pnpm build

echo
echo "Running analyze for sample: $TARGET_DIR"
node bin/leflect analyze --root "$TARGET_DIR" --config "$CONFIG_PATH" --incremental "$@"

echo
echo "Summary report"
node bin/leflect report summary --root "$TARGET_DIR" --config "$CONFIG_PATH"

echo
echo "JSP impact query: $QUERY_FILE"
node bin/leflect query jsp-impact --root "$TARGET_DIR" --config "$CONFIG_PATH" --file "$QUERY_FILE"

echo
echo "Declared entry summary: $ENTRY_ID"
python3 - <<'PY' "$TARGET_DIR/analysis/graph/entry-dependencies.json" "$ENTRY_ID"
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

print(
    json.dumps(
        {
            "id": record["id"],
            "nodeCount": record["nodeCount"],
            "edgeCount": record["edgeCount"],
            "reachableFiles": len(record.get("reachableFiles", [])),
            "seedGroups": {
                key: len(value)
                for key, value in record.get("seeds", {}).items()
            },
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
