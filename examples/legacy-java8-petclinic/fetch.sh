#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
OVERLAY_DIR="$SCRIPT_DIR/overlay"

SAMPLE_URL=${PETCLINIC_GIT_URL:-https://github.com/spring-petclinic/spring-framework-petclinic.git}
SAMPLE_TAG=${PETCLINIC_GIT_TAG:-v5.0.8}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/spring-framework-petclinic-$SAMPLE_TAG"}
CONFIG_PATH="$TARGET_DIR/leflect.config.ts"
DEFAULT_WORKER_JAR=$(find "$REPO_ROOT/java-worker/target" -maxdepth 1 -type f -name 'leflectjava-java-worker-*.jar' ! -name 'original-*' | sort -r | head -n 1)
WORKER_JAR=${LEFLECT_JAVA_WORKER_JAR:-}

if [ -z "$WORKER_JAR" ] && [ -n "$DEFAULT_WORKER_JAR" ] && [ -f "$DEFAULT_WORKER_JAR" ]; then
  WORKER_JAR="$DEFAULT_WORKER_JAR"
fi

build_default_classpath() {
  python3 - <<'PY'
from pathlib import Path
import json

home = Path.home()
repo = home / '.m2' / 'repository'


def add(entries, *paths):
    for path in paths:
        if path.exists():
            entries.append(str(path))


entries = []
add(
    entries,
    repo / 'org' / 'springframework' / 'spring-aop' / '5.0.8.RELEASE' / 'spring-aop-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-beans' / '5.0.8.RELEASE' / 'spring-beans-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-context' / '5.0.8.RELEASE' / 'spring-context-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-core' / '5.0.8.RELEASE' / 'spring-core-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-expression' / '5.0.8.RELEASE' / 'spring-expression-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-jcl' / '5.0.8.RELEASE' / 'spring-jcl-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-web' / '5.0.8.RELEASE' / 'spring-web-5.0.8.RELEASE.jar',
    repo / 'org' / 'springframework' / 'spring-webmvc' / '5.0.8.RELEASE' / 'spring-webmvc-5.0.8.RELEASE.jar',
    repo / 'javax' / 'servlet' / 'jsp' / 'jstl' / 'javax.servlet.jsp.jstl-api' / '1.2.2' / 'javax.servlet.jsp.jstl-api-1.2.2.jar',
    repo / 'org' / 'apache' / 'taglibs' / 'taglibs-standard-impl' / '1.2.5' / 'taglibs-standard-impl-1.2.5.jar',
    repo / 'org' / 'apache' / 'taglibs' / 'taglibs-standard-jstlel' / '1.2.5' / 'taglibs-standard-jstlel-1.2.5.jar',
    repo / 'org' / 'apache' / 'taglibs' / 'taglibs-standard-spec' / '1.2.5' / 'taglibs-standard-spec-1.2.5.jar',
)
print(json.dumps(entries))
PY
}

DEFAULT_CLASSPATH_JSON=$(build_default_classpath)
DEFAULT_CLASSPATH_COUNT=$(python3 - <<'PY' "$DEFAULT_CLASSPATH_JSON"
import json
import sys
print(len(json.loads(sys.argv[1])))
PY
)

if [ -n "$WORKER_JAR" ]; then
  JSP_AST_MODE=${LEFLECT_JSP_AST_MODE:-jasper}
else
  JSP_AST_MODE=${LEFLECT_JSP_AST_MODE:-lightweight}
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" fetch --depth 1 origin "refs/tags/$SAMPLE_TAG:refs/tags/$SAMPLE_TAG"
  git -C "$TARGET_DIR" checkout --force "$SAMPLE_TAG"
else
  rm -rf "$TARGET_DIR"
  git clone --branch "$SAMPLE_TAG" --depth 1 "$SAMPLE_URL" "$TARGET_DIR"
fi

if [ -d "$OVERLAY_DIR" ]; then
  cp -R "$OVERLAY_DIR/." "$TARGET_DIR/"
fi

python3 - <<'PY' "$CONFIG_PATH" "$WORKER_JAR" "$JSP_AST_MODE" "$DEFAULT_CLASSPATH_JSON"
import json
import os
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
worker_jar = sys.argv[2]
jsp_ast_mode = sys.argv[3]
default_classpath = json.loads(sys.argv[4])


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
    },
    "entryFiles": {
        "java": [
            "LegacyOwnerConsoleAdapter\\.java$",
        ],
        "jsp": [
            "WEB-INF/jsp/legacy/.+\\.jsp$",
        ],
    },
    "entries": [
        {
            "id": "legacy.owner.console",
            "type": "virtual_page",
            "label": "Legacy Owner Console",
            "description": "Virtual page sample with JSP fan-out and a six-hop adapter chain into Java files.",
            "jsp": [
                "src/main/webapp/WEB-INF/jsp/legacy/virtualOwnerConsole.jsp",
                "src/main/webapp/WEB-INF/jsp/legacy/fragments/ownerConsolePanel.jsp",
            ],
            "tags": ["legacy", "sample", "depth-5"],
            "variants": [
                {
                    "id": "legacy.owner.console.adapter",
                    "label": "Legacy Owner Console Adapter Seed",
                    "java": [
                        "src/main/java/org/springframework/samples/petclinic/web/legacy/LegacyOwnerConsoleAdapter.java",
                    ],
                    "tags": ["adapter"],
                }
            ],
        }
    ],
    "java": {
        "mavenCommand": "./mvnw",
    },
    "jsp": {
        "astMode": jsp_ast_mode,
        "webappRoot": "./src/main/webapp",
        "generatedJavaOut": "./analysis/generated-jsp-java",
        "astOut": "./analysis/jsp-ast",
        "mavenCommand": "./mvnw",
    },
}

jsp_classpath = split_env_list("LEFLECT_JSP_CLASSPATH") or default_classpath
if jsp_classpath:
    config["jsp"]["classpath"] = jsp_classpath
else:
    config["jsp"].pop("classpath", None)

jsp_maven = os.environ.get("LEFLECT_JSP_MAVEN_COMMAND")
if jsp_maven:
    config["jsp"]["mavenCommand"] = jsp_maven

if worker_jar:
    config["java"]["workerJar"] = worker_jar
    java_classpath = split_env_list("LEFLECT_JAVA_CLASSPATH") or default_classpath
    if java_classpath:
        config["java"]["classpath"] = java_classpath
    else:
        config["java"].pop("classpath", None)
    java_home = os.environ.get("LEFLECT_JAVA_HOME")
    if java_home:
        config["java"]["javaHome"] = java_home
    jre_home = os.environ.get("LEFLECT_JRE_HOME")
    if jre_home:
        config["java"]["jreHome"] = jre_home
    java_maven = os.environ.get("LEFLECT_JAVA_MAVEN_COMMAND")
    if java_maven:
        config["java"]["mavenCommand"] = java_maven
else:
    config["java"].pop("workerJar", None)
    config["java"].pop("classpath", None)

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
echo "Java worker: ${WORKER_JAR:-disabled}"
echo "JSP AST mode: $JSP_AST_MODE"
echo "Default dependency jars detected: $DEFAULT_CLASSPATH_COUNT"
echo "Validation hints:"
grep -n "<packaging>\|<java.version>" "$TARGET_DIR/pom.xml" || true
find "$TARGET_DIR/src/main/webapp/WEB-INF/jsp" -type f | sed "s|$TARGET_DIR/||" | sort | head -n 5
