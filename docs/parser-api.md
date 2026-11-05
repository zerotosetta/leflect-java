# 통합 패키지의 JSP/TLD 파서 API

`leflect-java` 0.1.9부터 Java 분석 API와 JSP/TLD 파서를 같은 패키지에서 사용할 수 있습니다. standalone tgz에는 JavaScript와 타입 선언을 함께 번들링합니다. 별도 `@leflect-java/parser-jsp`, `@leflect-java/parser-tld`, `@leflect-java/schema` 설치 없이 사용합니다. 이 문서는 tgz의 `PARSER_API.md`에도 포함됩니다.

## 공개 함수와 호출 규약

| 함수 | 입력 | 결과 |
| --- | --- | --- |
| `parseJsp(content, options?)` | JSP 문자열, 선택적 `JspParseOptions` | 동기적 `JspParseResult` |
| `parseTld(xml)` | TLD XML 문자열 | 동기적 `TldIndex` |
| `loadTldRegistry(options)` | 명시한 TLD/JAR 입력 목록 | `Promise<{ entries, diagnostics }>` |
| `analyzeWorkspace(options)` | 기존 Java/JSP 분석 설정 | 기존 비동기 분석 결과 |

모듈 import/require는 CLI를 실행하거나 결과를 출력하지 않습니다. `parseJsp`와 `parseTld`는 전달한 문자열만 파싱하며 Java 실행·파일 검색을 하지 않습니다. `loadTldRegistry`는 지정한 자료를 읽는 별도 비동기 API입니다. CLI는 `leflect` 명령으로 명시적으로 실행합니다.

ESM:

```javascript
import { parseJsp, parseTld, loadTldRegistry } from "leflect-java";

const jsp = parseJsp('<bank:task code="${customer.id}"/>');
const tld = parseTld('<taglib><uri>urn:bank</uri></taglib>');
const registry = await loadTldRegistry({
  root: "/project",
  repoFiles: ["WEB-INF/bank.tld"],
  classpathEntries: ["/dependencies/bank-tags.jar"],
  autoLoad: true
});
```

CommonJS:

```javascript
const { parseJsp, parseTld, loadTldRegistry } = require("leflect-java");
const document = parseJsp("<div>hello</div>").document;
```

`run`도 기존 CLI 프로그램 호출용 API로 유지합니다. 문자열 파서만 필요한 소비자는 `run`이나 `analyzeWorkspace`를 호출할 필요가 없습니다.

## 타입과 AST 계약

명시적으로 공개하는 타입은 다음과 같습니다.

- JSP: `JspParseOptions`, `JspParseResult`, `JspDocumentNode`
- TLD: `TldIndex`, `LoadTldRegistryOptions`, `TldRegistryDiagnostic`
- 공통: `LineRange`, `TldRegistryEntry`, `TldRegistryTag`, `TldAttributeSchema`
- 기존 분석 API: `AnalyzeEvent`, `AnalyzeStageResult`, `AnalyzeWorkspaceOptions`, `AnalyzeWorkspaceResult`

타입 선언은 schema·parser·하위 JSP 노드와 EL AST까지 포함합니다. `ReturnType<typeof parseEl>`이 가리키는 타입도 선언 안에서 완결됩니다. 내부 보조 선언을 사용하기 위해 별도 parser/schema 패키지나 `parseEl` 런타임 export를 추가할 필요가 없습니다. 동일한 이름을 가진 schema의 semantic AST와 parser의 document AST를 `export *`로 합치지 않습니다.

```typescript
import { parseJsp, type JspDocumentNode, type LineRange } from "leflect-java";

type ElAst = Extract<JspDocumentNode, { kind: "ElExpression" }>["ast"];

function visit(node: JspDocumentNode): void {
  const position: LineRange = node.lineRange;
  if (node.kind === "HtmlElement" || node.kind === "CustomTagElement") {
    const values: Record<string, string> = node.attributes;
    for (const attribute of node.attributeNodes ?? []) visit(attribute);
    void values;
  }
  if (node.kind === "ElExpression") {
    const expression: ElAst = node.ast;
    if (expression.kind === "PropertyAccessExpression") {
      const target: ElAst = expression.target;
      void target;
    }
  }
  if ("children" in node) node.children.forEach(visit);
  void position;
}

visit(parseJsp('<div value="${customer.id}"/>').document);
```

`document`는 `kind: "Document"`와 `children`을 유지합니다. HTML/custom tag의 `attributes`, 속성 노드의 `children`, EL 노드의 `ast`와 재귀 타입도 유지합니다. `lineRange`는 **1부터 시작하는 행·열**, JavaScript 문자열의 **UTF-16 코드 단위** 기준이며 종료 위치는 **포함**합니다. 원문이나 개행을 바꾼 뒤 이전 위치와 혼용하지 않습니다. JSP·JSPF·태그 파일은 `sourceKind`, XML 형태는 `syntax: "xml"` 등 기존 `JspParseOptions`로 구분합니다.

## TLD 입력 범위와 진단

`root`는 상대 경로의 해석 기준입니다. `repoFiles: []`를 전체 저장소 검색으로 바꾸지 않습니다. `repoFiles`, `configuredPaths`, `classpathEntries`, `uriMap`이 모두 비어 있으면 `autoLoad: true`여도 파일 시스템을 탐색하지 않고 빈 결과를 반환합니다.

| 입력 | 실제 조회 범위 |
| --- | --- |
| `repoFiles` | 목록에 지정한 TLD 파일 또는 JAR 엔트리만 읽음 |
| `configuredPaths`의 `.tld` 파일 | 그 파일만 읽고 형제 파일을 추가하지 않음 |
| `configuredPaths`의 `.jar` 파일 | 지정한 JAR 내부의 `.tld` 엔트리들을 읽음 |
| `configuredPaths`의 디렉터리 | 해당 디렉터리를 재귀 탐색해 `.tld`와 JAR 내부 TLD를 읽음 |
| `classpathEntries`, `autoLoad: true` | 지정한 파일/JAR만 사용. 디렉터리면 재귀 탐색한 JAR의 TLD를 읽고 loose `.tld`는 자동 수집하지 않음 |
| `classpathEntries`, `autoLoad: false` | classpath 자동 로드하지 않음 |
| `uriMap` | URI에 지정한 `.tld` 파일 또는 `archive.jar!/entry.tld`만 읽음 |

따라서 명시 파일 목록만 처리하려는 소비자는 저장소 전체나 라이브러리 디렉터리를 `configuredPaths`/classpath에 넘기지 않습니다. 루트 디렉터리는 상대 경로 해석 기준이며 보안용 경계 검사나 symlink 격리를 대신하지 않습니다. POC의 기존 입력 경계 정책은 호출자에서 유지합니다.

엔트리는 `uri`, `tags[].handlerClass`, `tags[].attributes`와 `sourcePath`/`sourceKind`를 보존합니다. `repoFiles`의 상대 원본 경로는 상대 표기를 유지하고, configured/classpath 자료는 정규화한 경로를 반환합니다. JAR 출처는 `/`로 정규화한 `archive.jar!/entry.tld` 형태입니다.

동일 URI가 중복되면 `duplicate-uri` 진단에 URI와 출처를 남깁니다. 우선순위는 `uriMap` → repo → configured path → classpath이며, 같은 우선순위에서는 먼저 지정한 자료를 유지합니다. POC처럼 중복 URI를 모호한 바인딩으로 처리하는 소비자는 이 진단을 계속 확인합니다. 읽을 수 없는 명시 원본은 `invalid-source` 또는 `invalid-jar-entry`로 구분합니다.

## 단일 tgz 소비자 검증

빈 디렉터리에서 다음과 같이 설치할 수 있습니다.

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./leflect-java-0.1.9.tgz
```

저장소의 `scripts/test-npx-package.mjs`는 생성한 tgz를 저장소 밖 새 디렉터리에 단독 설치해 다음을 확인합니다.

- 정적 ESM named import와 CommonJS require의 동일한 함수 API
- import와 문자열 파싱의 무출력·무탐색·무 Java 실행
- 명시 TLD/JAR 조회, 빈 입력의 파일 접근 0회, 명시 디렉터리의 허용된 재귀 범위
- URI·handler·속성·원본 경로·중복 진단과 JSP/EL AST 및 위치
- 별도 workspace 패키지 없이 `strict: true`, `skipLibCheck: false`, `types: []`, `typeRoots: []`로 Node16/NodeNext 및 CommonJS 소비자 컴파일
- 컴파일에 포함된 모든 선언 파일이 격리 디렉터리 안에 있으며 부모 `node_modules`를 사용하지 않음

```sh
node scripts/test-npx-package.mjs --tarball .artifacts/packages/leflect-java-0.1.9.tgz --keep-temp
```

POC에서는 세 함수와 위 타입들의 import 경로를 `leflect-java`로 통합하고 기존 0.1.7 parser/schema 의존성을 제거할 수 있습니다. SKILL 명령·입출력 규약과 ATK 본체는 이 공개 API 변경으로 바꿀 필요가 없습니다.
