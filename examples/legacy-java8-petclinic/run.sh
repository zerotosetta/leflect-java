#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_TAG=${PETCLINIC_GIT_TAG:-v5.0.8}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/spring-framework-petclinic-$SAMPLE_TAG"}
CONFIG_PATH="$TARGET_DIR/leflect.config.json"
QUERY_FILE=${QUERY_FILE:-src/main/webapp/WEB-INF/jsp/owners/findOwners.jsp}

bash "$SCRIPT_DIR/fetch.sh" "$TARGET_DIR"

cd "$REPO_ROOT"
pnpm build

echo
echo "Running analyze for sample: $TARGET_DIR"
node bin/leflect analyze --root "$TARGET_DIR" --config "$CONFIG_PATH" --incremental

echo
echo "Summary report"
node bin/leflect report summary --root "$TARGET_DIR" --config "$CONFIG_PATH"

echo
echo "JSP impact query: $QUERY_FILE"
node bin/leflect query jsp-impact --root "$TARGET_DIR" --config "$CONFIG_PATH" --file "$QUERY_FILE"

echo
echo "Artifacts:"
echo "  $TARGET_DIR/analysis/report/summary.json"
echo "  $TARGET_DIR/analysis/report/unresolved.json"
echo "  $TARGET_DIR/analysis/report/impact.md"
