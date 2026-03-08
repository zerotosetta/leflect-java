#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

SAMPLE_URL=${PETCLINIC_GIT_URL:-https://github.com/spring-petclinic/spring-framework-petclinic.git}
SAMPLE_TAG=${PETCLINIC_GIT_TAG:-v5.0.8}
TARGET_DIR=${1:-"$REPO_ROOT/.examples/spring-framework-petclinic-$SAMPLE_TAG"}
CONFIG_PATH="$TARGET_DIR/leflect.config.json"
TEMPLATE_CONFIG_PATH="$SCRIPT_DIR/leflect.config.json"
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

python3 - <<'PY' "$CONFIG_PATH" "$TEMPLATE_CONFIG_PATH" "$WORKER_JAR" "$JSP_AST_MODE" "$DEFAULT_CLASSPATH_JSON"
import json
import os
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
template_path = Path(sys.argv[2])
worker_jar = sys.argv[3]
jsp_ast_mode = sys.argv[4]
default_classpath = json.loads(sys.argv[5])


def split_env_list(name: str):
    raw = os.environ.get(name, "")
    if not raw:
        return []
    return [entry for entry in raw.split(os.pathsep) if entry]

config = json.loads(template_path.read_text(encoding="utf-8"))
config["analysisOut"] = "./analysis"
config["ignoreFile"] = "./.gitignore"
config["labelsOut"] = "./analysis/index/labels.json"

classpath_discovery = config.setdefault("classpathDiscovery", {})
classpath_discovery["enabled"] = True

jsp_config = config.setdefault("jsp", {})
jsp_config["astMode"] = jsp_ast_mode
jsp_config["webappRoot"] = "./src/main/webapp"
jsp_config["generatedJavaOut"] = "./analysis/generated-jsp-java"
jsp_config["astOut"] = "./analysis/jsp-ast"

jsp_classpath = split_env_list("LEFLECT_JSP_CLASSPATH") or default_classpath
if jsp_classpath:
    jsp_config["classpath"] = jsp_classpath
else:
    jsp_config.pop("classpath", None)

jsp_maven = os.environ.get("LEFLECT_JSP_MAVEN_COMMAND")
if jsp_maven:
    jsp_config["mavenCommand"] = jsp_maven

java_config = config.setdefault("java", {})
if worker_jar:
    java_config["workerJar"] = worker_jar
    java_classpath = split_env_list("LEFLECT_JAVA_CLASSPATH") or default_classpath
    if java_classpath:
        java_config["classpath"] = java_classpath
    else:
        java_config.pop("classpath", None)
    java_home = os.environ.get("LEFLECT_JAVA_HOME")
    if java_home:
        java_config["javaHome"] = java_home
    jre_home = os.environ.get("LEFLECT_JRE_HOME")
    if jre_home:
        java_config["jreHome"] = jre_home
    java_maven = os.environ.get("LEFLECT_JAVA_MAVEN_COMMAND")
    if java_maven:
        java_config["mavenCommand"] = java_maven
else:
    java_config.pop("workerJar", None)
    java_config.pop("classpath", None)

config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
PY

echo "Sample ready: $TARGET_DIR"
echo "Config ready: $CONFIG_PATH"
echo "Java worker: ${WORKER_JAR:-disabled}"
echo "JSP AST mode: $JSP_AST_MODE"
echo "Default dependency jars detected: $DEFAULT_CLASSPATH_COUNT"
echo "Validation hints:"
grep -n "<packaging>\|<java.version>" "$TARGET_DIR/pom.xml" || true
find "$TARGET_DIR/src/main/webapp/WEB-INF/jsp" -type f | sed "s|$TARGET_DIR/||" | sort | head -n 5
