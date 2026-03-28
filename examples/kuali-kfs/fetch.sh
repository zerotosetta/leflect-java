#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_URL=${KFS_GIT_URL:-https://github.com/kuali/kfs.git}
SAMPLE_REF=${KFS_GIT_REF:-master}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/kuali-kfs-$SAMPLE_REF"}
CONFIG_PATH="$TARGET_DIR/leflect.config.ts"
MAVEN_WRAPPER_REL=".leflect/mvn-kfs-web.sh"
MAVEN_WRAPPER_PATH="$TARGET_DIR/$MAVEN_WRAPPER_REL"

DEFAULT_WORKER_JAR=""
if [ -d "$REPO_ROOT/java-worker/target" ]; then
  DEFAULT_WORKER_JAR=$(find "$REPO_ROOT/java-worker/target" -maxdepth 1 -type f -name 'leflectjava-java-worker-*.jar' ! -name 'original-*' | sort -r | head -n 1)
fi
WORKER_JAR=${LEFLECT_JAVA_WORKER_JAR:-}

if [ -z "$WORKER_JAR" ] && [ -n "$DEFAULT_WORKER_JAR" ] && [ -f "$DEFAULT_WORKER_JAR" ]; then
  WORKER_JAR="$DEFAULT_WORKER_JAR"
fi

if [ -n "${LEFLECT_JSP_AST_MODE:-}" ]; then
  JSP_AST_MODE="$LEFLECT_JSP_AST_MODE"
elif [ -n "$WORKER_JAR" ]; then
  JSP_AST_MODE="jasper"
else
  JSP_AST_MODE="lightweight"
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" fetch --depth 1 origin "$SAMPLE_REF"
  git -C "$TARGET_DIR" checkout --force FETCH_HEAD
else
  rm -rf "$TARGET_DIR"
  git clone --branch "$SAMPLE_REF" --depth 1 "$SAMPLE_URL" "$TARGET_DIR"
fi

mkdir -p "$(dirname "$MAVEN_WRAPPER_PATH")"
cat > "$MAVEN_WRAPPER_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

MAVEN_EXECUTABLE=${LEFLECT_KFS_MAVEN_EXECUTABLE:-mvn}
exec "$MAVEN_EXECUTABLE" -pl kfs-web -am "$@"
EOF
chmod +x "$MAVEN_WRAPPER_PATH"

python3 - <<'PY' "$CONFIG_PATH" "$WORKER_JAR" "$JSP_AST_MODE" "$MAVEN_WRAPPER_REL"
import json
import os
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
worker_jar = sys.argv[2]
jsp_ast_mode = sys.argv[3]
maven_wrapper_rel = sys.argv[4]


def split_env_list(name: str):
    raw = os.environ.get(name, "")
    if not raw:
        return []
    return [entry for entry in raw.split(os.pathsep) if entry]


config = {
    "analysisOut": "./analysis",
    "ignoreFile": "./.gitignore",
    "labelsOut": "./analysis/index/labels.json",
    "classpathDiscovery": {
        "enabled": True,
        "maxRetries": 5,
    },
    "entryFiles": {
        "jsp": [
            "^kfs-web/src/main/webapp/jsp/.+\\.jsp$",
            "^kfs-web/src/main/webapp/WEB-INF/jsp/.+\\.jsp$",
        ],
    },
    "entries": [
        {
            "id": "kfs.fp.disbursement-voucher",
            "type": "virtual_page",
            "label": "KFS FP Disbursement Voucher",
            "description": "Representative Financial Processing document screen.",
            "jsp": [
                "kfs-web/src/main/webapp/jsp/fp/DisbursementVoucher.jsp",
            ],
            "tags": ["kfs", "fp", "document"],
        },
        {
            "id": "kfs.ar.customer-invoice",
            "type": "virtual_page",
            "label": "KFS AR Customer Invoice",
            "description": "Representative Accounts Receivable document screen.",
            "jsp": [
                "kfs-web/src/main/webapp/jsp/module/ar/CustomerInvoiceDocument.jsp",
            ],
            "tags": ["kfs", "ar", "document"],
        },
        {
            "id": "kfs.tem.travel-reimbursement",
            "type": "virtual_page",
            "label": "KFS TEM Travel Reimbursement",
            "description": "Representative Travel and Entertainment document screen.",
            "jsp": [
                "kfs-web/src/main/webapp/jsp/module/tem/TravelReimbursement.jsp",
            ],
            "tags": ["kfs", "tem", "document"],
        },
    ],
    "java": {
        "mavenCommand": f"./{maven_wrapper_rel}",
    },
    "jsp": {
        "astMode": jsp_ast_mode,
        "webappRoot": "./kfs-web/src/main/webapp",
        "generatedJavaOut": "./analysis/generated-jsp-java",
        "astOut": "./analysis/jsp-ast",
        "mavenCommand": f"./{maven_wrapper_rel}",
    },
}

search_roots = split_env_list("LEFLECT_KFS_SEARCH_ROOTS")
if search_roots:
    config["classpathDiscovery"]["searchRoots"] = search_roots

jsp_classpath = split_env_list("LEFLECT_JSP_CLASSPATH")
if jsp_classpath:
    config["jsp"]["classpath"] = jsp_classpath

java_classpath = split_env_list("LEFLECT_JAVA_CLASSPATH")
if java_classpath:
    config["java"]["classpath"] = java_classpath

jre_home = os.environ.get("LEFLECT_JRE_HOME")
if jre_home:
    config["java"]["jreHome"] = jre_home

java_home = os.environ.get("LEFLECT_JAVA_HOME")
if java_home:
    config["java"]["javaHome"] = java_home

if worker_jar:
    config["java"]["workerJar"] = worker_jar

rendered = "\n".join([
    'import { defineConfig } from "@leflect-java/core";',
    "",
    f"export default defineConfig({json.dumps(config, indent=2)});",
    "",
])
config_path.write_text(rendered, encoding="utf-8")
PY

echo "Sample ready: $TARGET_DIR"
echo "Config ready: $CONFIG_PATH"
echo "Ref: $SAMPLE_REF"
echo "Java worker: ${WORKER_JAR:-disabled}"
echo "JSP AST mode: $JSP_AST_MODE"
echo "Representative JSP entries:"
find "$TARGET_DIR/kfs-web/src/main/webapp/jsp" -type f -name '*.jsp' | sed "s|$TARGET_DIR/||" | sort | head -n 5
