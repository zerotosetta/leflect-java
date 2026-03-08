#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_URL=${PETCLINIC_GIT_URL:-https://github.com/spring-petclinic/spring-framework-petclinic.git}
SAMPLE_TAG=${PETCLINIC_GIT_TAG:-v5.0.8}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/spring-framework-petclinic-$SAMPLE_TAG"}
CONFIG_PATH="$TARGET_DIR/leflect.config.json"
JSP_AST_MODE=${LEFLECT_JSP_AST_MODE:-$(if [ -n "${LEFLECT_JAVA_WORKER_JAR:-}" ]; then echo "jasper"; else echo "lightweight"; fi)}

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" fetch --depth 1 origin "refs/tags/$SAMPLE_TAG:refs/tags/$SAMPLE_TAG"
  git -C "$TARGET_DIR" checkout --force "$SAMPLE_TAG"
else
  rm -rf "$TARGET_DIR"
  git clone --branch "$SAMPLE_TAG" --depth 1 "$SAMPLE_URL" "$TARGET_DIR"
fi

cat >"$CONFIG_PATH" <<EOF
{
  "analysisOut": "./analysis",
  "ignoreFile": ".gitignore",
  "labelsOut": "./analysis/index/labels.json",
  "jsp": {
    "astMode": "$JSP_AST_MODE",
    "webappRoot": "src/main/webapp"$(if [ -n "${LEFLECT_JSP_MAVEN_COMMAND:-}" ]; then
      printf ',\n    "mavenCommand": "%s"' "$LEFLECT_JSP_MAVEN_COMMAND"
    fi)$(if [ -n "${LEFLECT_JSP_CLASSPATH:-}" ]; then
      python3 - <<'PY'
import json
import os

entries = [entry for entry in os.environ["LEFLECT_JSP_CLASSPATH"].split(os.pathsep) if entry]
print(',\n    "classpath": ' + json.dumps(entries))
PY
    fi)
  }$(if [ -n "${LEFLECT_JAVA_WORKER_JAR:-}" ]; then
    printf ',\n  "java": {\n    "workerJar": "%s"%s\n  }' \
      "$LEFLECT_JAVA_WORKER_JAR" \
      "$(if [ -n "${LEFLECT_JAVA_HOME:-}" ]; then
        printf ',\n    "javaHome": "%s"' "$LEFLECT_JAVA_HOME"
      fi)"
  fi)
}
EOF

echo "Sample ready: $TARGET_DIR"
echo "Config ready: $CONFIG_PATH"
echo "JSP AST mode: $JSP_AST_MODE"
echo "Validation hints:"
grep -n "<packaging>\\|<java.version>" "$TARGET_DIR/pom.xml" || true
find "$TARGET_DIR/src/main/webapp/WEB-INF/jsp" -type f | sed "s|$TARGET_DIR/||" | sort | head -n 5
