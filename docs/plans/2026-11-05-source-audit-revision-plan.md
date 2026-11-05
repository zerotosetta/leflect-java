# 원본 전수 대조 후속 수정 계획서 초안

상태: **사용자 제안 작성용 초안 · 구현 전**. 확인된 보완 4개 유형과 지원 범위·계약 확인 3개 항목을 검토합니다. 기존 검수 키를 그대로 사용합니다. 각 항목의 **사용자 제안**을 채우고 **완료 기준 수정·추가**에 의견을 적어 주세요. 아래 완료 기준은 검토용이며 아직 확정하지 않았습니다.

기준은 `legacy-bank-java8`의 `rebuild-20261105-103212`, 분석기 소스 `dd0b520`입니다. 원본 입력 84개의 해시가 분석 당시와 일치합니다. 아래 `src/...`는 원본 프로젝트 기준 경로이고, `index/...`·`java-ast/...`는 해당 분석 결과 디렉터리 기준 경로입니다. 코드와 JSON은 실제 자료에서 필요한 부분만 발췌했습니다. 제안하는 새 출력 필드를 현재 분석 결과처럼 표시하지 않았습니다.

- [원본 전수 대조 보고서](../audits/legacy-bank-java8-source-audit-20261105/README.md)
- [모든 발견 위치의 원본·기대/실제 결과](../audits/legacy-bank-java8-source-audit-20261105/findings.json)
- [파일·메서드별 검수 범위](../audits/legacy-bank-java8-source-audit-20261105/coverage.json)

| 키 | 항목 | 기준 범위 | 현재 판정 | 사용자 결정 |
| --- | --- | --- | --- | --- |
| [AUD2-IMPORT-01](#aud2-import-01) | wildcard import의 인덱스 위치 유실 | 116곳 / 36파일 | 확정 메타데이터 누락 | 제안 작성 |
| [AUD2-IMPORT-02](#aud2-import-02) | import 근거 오연결·누락 | 타입 참조 20레코드 / 5파일, 호출 메타데이터 14레코드 / 2파일 | 확정 메타데이터 보완 | 제안 작성 |
| [AUD2-EXEC-01](#aud2-exec-01) | continue 제어 이동·후속 실행 조건 | 1곳 | 확정 구조화 요약 누락 | 제안 작성 |
| [AUD2-EXEC-02](#aud2-exec-02) | 증가 연산의 상태 변경 단계 | 4곳 / 2파일·3메서드 | 확정 구조화 요약 누락 | 제안 작성 |
| [REVIEW-TYPE-01](#review-type-01) | 제네릭 호출식 결과 타입 | 78곳 / 26파일 | 출력 계약 확인 | 지원 정책 선택 |
| [REVIEW-EXEC-01](#review-exec-01) | 단락 조건의 평가 가드 | 68곳 / 19파일·23메서드 | 지원 범위 확인 | 지원 정책 선택 |
| [REVIEW-DECL-01](#review-decl-01) | 초기화 없는 선언의 분류 | 12개 / 5파일 | 표현 계약 확인 | 지원 정책 선택 |

단위가 다른 레코드와 중복되는 코드는 합산하지 않습니다. AUD2-IMPORT-02의 영향 파일 합집합은 6개입니다. 호출 646곳의 대상은 정확하며, 실행 요약에서 표현되지 않은 코드도 원시 AST와 상위 snippet에는 보존되어 있습니다. 마지막 3개 항목을 호출 오탐·누락 건수로 집계하지 않습니다.

## AUD2-IMPORT-01

**wildcard import의 인덱스 위치 유실 · 116곳 / 36파일**

원본 `src/main/java/demo/bank/BankServlet.java:4`:

```java
import javax.servlet.*;
```

실제 `index/java/src/main/java/demo/bank/BankServlet.java.json`의 `classReferences` 발췌:

```json
{
  "kind": "import-wildcard",
  "qualifiedName": "javax.servlet",
  "location": { "line": 4, "column": 1, "endLine": 4, "endColumn": 23 },
  "snippet": "import javax.servlet.*;"
}
```

같은 파일의 실제 `importEntries` 발췌:

```json
{
  "id": "java-import:src/main/java/demo/bank/BankServlet.java:javax.servlet.*",
  "file": "src/main/java/demo/bank/BankServlet.java",
  "import": "javax.servlet.*",
  "simpleName": "servlet"
}
```

import 식별 154개는 모두 존재합니다. 명시 import 38개에는 위치가 있고, wildcard import 116개에는 `location`이 없습니다. 원시 참조에서 인덱스로 전달하는 과정의 누락입니다.

**검토할 방향** — import 선언의 표기와 원시 참조를 같은 기준으로 대응시켜 전체 범위를 전달합니다. wildcard 패키지를 클래스 그래프 대상으로 추가할지는 별개 범위입니다.

**검토 질문** — import 선언을 식별하는 기준과 위치의 출처를 무엇으로 통일할 것인가? 인덱스·상세 조회에서도 같은 위치를 확인할 수 있는가?

- **사용자 제안** —
- **완료 기준 수정·추가** —

**완료 기준 초안**

- [ ] 116개 wildcard import의 파일·시작/종료 행·열이 원본 및 원시 참조와 일치하고 `importEntries`에서 확인됩니다.
- [ ] 기존 154개 import의 ID·표기와 명시 import 38개의 위치를 보존하며 다른 선언에 위치를 붙이거나 중복 생성하지 않습니다.
- [ ] 일반·wildcard·static import의 표기 차이를 회귀 검증합니다. 이 수정만으로 패키지를 타입 그래프에 추가하지 않습니다.

## AUD2-IMPORT-02

**import 근거 오연결·누락 · 타입 참조 20개와 호출 메타데이터 14개**

원본 `BankServlet.java:4–5`와 `:7`:

```java
import javax.servlet.*;
import javax.servlet.http.*;
```

```java
public final class BankServlet extends HttpServlet {
```

실제 `index/java/src/main/java/demo/bank/BankServlet.java.json`의 `classReferences` 발췌:

```json
{
  "className": "HttpServlet",
  "qualifiedName": "javax.servlet.http.HttpServlet",
  "importId": "java-import:src/main/java/demo/bank/BankServlet.java:javax.servlet.*",
  "kind": "extends",
  "location": { "line": 7, "column": 40, "endLine": 7, "endColumn": 50 }
}
```

대상 FQN은 정확하지만 import 근거가 상위 패키지입니다. `javax.servlet.*`는 하위 패키지의 HttpServlet을 가져오지 않으므로 이 사용의 기대 근거는 `javax.servlet.http.*`입니다. 같은 파일 15행의 `request.getMethod()`도 실제 결과는 다음과 같습니다.

```json
{
  "resolvedMethodId": "javax.servlet.http.HttpServletRequest#getMethod()",
  "importId": "java-import:src/main/java/demo/bank/BankServlet.java:javax.servlet.*",
  "snippet": "request.getMethod()",
  "location": { "line": 15, "column": 30, "endLine": 15, "endColumn": 48 }
}
```

제네릭 타입의 연결 누락도 있습니다. 원본 `src/main/java/demo/bank/WBFRecord.java:3`, `:10`:

```java
import java.util.ArrayList;
```

```java
private List<Map<String,Object>> rows = new ArrayList<Map<String,Object>>();
```

실제 `index/java/src/main/java/demo/bank/WBFRecord.java.json`의 `classReferences` 발췌:

```json
{
  "className": "ArrayList",
  "qualifiedName": "java.util.ArrayList<java.util.Map<java.lang.String, java.lang.Object>>",
  "classPath": "java.util.ArrayList<java.util.Map<java.lang.String, java.lang.Object>>",
  "resolvedClassId": "java.util.ArrayList",
  "kind": "new",
  "location": { "line": 10, "column": 49, "endLine": 10, "endColumn": 77 }
}
```

이 실제 JSON에는 `importId` 필드가 없습니다. 검수 비교 JSON의 `actualImportId: null`은 미제공을 나타낸 비교용 값이므로 실제 출력과 구분합니다.

확정 범위는 타입 참조 오연결 5개(일반 사용 3개·import 선언 2개)와 제네릭 연결 누락 15개입니다. 별도 호출 메타데이터 오연결 14개는 BankServlet 13개·TaskTag 1개입니다. 타입 FQN과 실제 호출 대상 시그니처는 보존되어 있습니다.

**검토할 방향** — 실제 타입과 원본 표기를 바탕으로 import 근거를 결정하고, 제네릭 인자는 기저 타입을 식별할 때와 실제 타입을 표시할 때 구별합니다. import 선언 자체의 링크와 타입/호출 사용의 근거 링크도 구별합니다.

**검토 질문** — `importId`는 원본의 어떤 선언을 근거로 하는가? 수신자·상속·암시적 타입에는 어떤 정책을 적용하며, 근거를 확정할 수 없으면 어떻게 표시할 것인가?

- **사용자 제안** —
- **완료 기준 수정·추가** —

**완료 기준 초안**

- [ ] 타입 참조 20개와 호출 메타데이터 14개를 각각 원본·기대 import 선언에 대조합니다. 원래 정확했던 타입 FQN·호출 대상·범위를 보존합니다.
- [ ] 패키지 wildcard가 하위 패키지에 잘못 적용되지 않고, 제네릭 기저 타입·명시 import·중첩 타입 등 이름 해석 차이를 회귀 검증합니다.
- [ ] FQN 직접 표기 5곳, 같은 패키지·java.lang·지역 타입을 임의의 import에 귀속하지 않습니다. 불명확하거나 모호한 근거를 임의로 확정하지 않습니다.
- [ ] importId 없는 호출 199개와 wildcard 선언 self-ID 미제공 114개는 먼저 정책을 확정합니다. 확정 누락으로 일괄 확대하지 않습니다.
- [ ] 전체 타입 참조 966개와 호출 646개의 기존 import 링크를 다시 대조하고, 타입 참조/호출 레코드의 건수를 분리합니다.

## AUD2-EXEC-01

**continue 제어 이동·후속 실행 조건 누락 · 1곳**

원본 `src/main/java/demo/bank/Cms.java:59–61`:

```java
if(step>0 && "content".equals(area)) continue;
if(!page.areas.containsKey(area)) throw new BankException(500,"CMS_AREA","Unknown area: "+area);
page.areas.get(area).add(component(c,overrides.containsKey(id)?overrides.get(id):id,page));
```

실제 `index/java/src/main/java/demo/bank/Cms.java.json`의 `load` 메서드 `orderedSteps` 중 후속 호출 발췌:

```json
{
  "kind": "call",
  "snippet": "page.areas.containsKey(area)",
  "branchPath": [
    "try:body", "normal-completion:40:13", "normal-completion:51:13",
    "try:body", "try:body", "while:body"
  ],
  "lineRange": { "startLine": 60, "startColumn": 25, "endLine": 60, "endColumn": 52 }
}
```

59행 58–66열의 `continue;`는 원시 AST와 상위 branch snippet에 남습니다. 하지만 독립 제어 이동 단계가 없고, 60–61행의 후속 단계에는 해당 반복 건이 continue하지 않았다는 조건이 없습니다. 이 문제는 CMS의 실제 forward 대상 연결 보류와 별개입니다.

**검토할 방향** — continue의 소유 반복문과 이동 효과를 표현하고, 현재 반복의 후속 본문이 실행되지 않는 조건을 보존합니다.

**검토 질문** — while/for의 이동 지점, 중첩 반복문·label·try/finally는 어디까지 지원할 것인가? 표현하지 않는 경우에도 제한을 구분할 수 있는가?

- **사용자 제안** —
- **완료 기준 수정·추가** —

**완료 기준 초안**

- [ ] 현재 1곳의 원본 범위·소유 메서드·소유 반복문과 continue 효과가 구조화된 결과에서 확인됩니다.
- [ ] continue가 선택된 반복 건에서 60–61행이 무조건 실행되는 것으로 나타나지 않습니다. 정상 진행 경로와 반복 종료를 구분합니다.
- [ ] while과 for의 이동 차이, for의 갱신식, 중첩 반복문을 검증합니다. label·try/finally의 적용 범위 또는 명시적인 제한도 결정합니다.
- [ ] 기존 return/throw·synchronized의 후속 조건과 원시 호출을 보존하고, AUD2-EXEC-02의 반복 갱신과 함께 검증합니다.

## AUD2-EXEC-02

**증가 연산의 상태 변경 단계 누락 · 4곳 / 2파일·3메서드**

원본 `src/main/java/demo/bank/QueryEngine.java:33`:

```java
if(position!=next++ || !input.hasField(field)) throw new BankException(500,"QUERY_PARAM","Missing parameter: " + field);
```

실제 `index/java/src/main/java/demo/bank/QueryEngine.java.json`의 `prepare` 메서드 발췌:

```json
{
  "kind": "branch",
  "snippet": "if (position != next++ || !input.hasField(field))\r\n    throw new BankException(500, \"QUERY_PARAM\", \"Missing parameter: \" + field);",
  "lineRange": { "startLine": 33, "startColumn": 21, "endLine": 33, "endColumn": 140 }
}
```

`next++`의 범위는 33행 34–39열입니다. 원문은 상위 snippet과 원시 AST에 남지만 독립적인 상태 변경 단계는 없습니다.

| 원본 위치 | 코드 | 맥락 |
| --- | --- | --- |
| callees/DepositOpen.java:18 | i++ | for 갱신 |
| QueryEngine.java:17 | i++ | for 갱신 |
| QueryEngine.java:33 | next++ | 조건식 내부 |
| QueryEngine.java:46 | i++ | for 갱신 |

**검토할 방향** — 연산 대상·전위/후위 구분·상태 변경 시점·원본 범위를 표현합니다. 구체적인 값을 계산하는 분석까지 포함할지는 별도 결정합니다.

**검토 질문** — 읽어 사용한 값과 변경된 값을 어떻게 구별할 것인가? `++/--`, 지역 변수·필드·배열 대상 중 어디까지 지원할 것인가?

- **사용자 제안** —
- **완료 기준 수정·추가** —

**완료 기준 초안**

- [ ] 실제 4곳의 연산·대상·범위와 상태 변경이 구조화된 결과에서 확인되며 기존 호출·분기와 원본 평가 순서가 일치합니다.
- [ ] 전위/후위, 증가/감소를 구별하고 부수 효과가 있는 대상을 중복 평가하지 않습니다. 선택한 지원 범위 밖의 대상은 그 상태를 구분합니다.
- [ ] for 갱신은 본문 뒤에 적용되고, continue 시의 갱신 경로도 AUD2-EXEC-01과 함께 검증합니다. 조건식 내부 연산은 원래 위치와 순서를 유지합니다.
- [ ] 기존 대입·필드 쓰기와 중복 집계하지 않습니다. 값 계산까지 지원한다고 임의로 해석하지 않도록 출력 계약을 명시합니다.

## REVIEW-TYPE-01

**제네릭 호출식 결과 타입의 출력 계약 · 78곳 / 26파일**

원본 `src/main/java/demo/bank/WBFRecord.java:9`, `:12`:

```java
private final Map<String,Object> fields = new LinkedHashMap<String,Object>();
```

```java
public Object getField(String name) { return fields.get(name); }
```

실제 `index/java/src/main/java/demo/bank/WBFRecord.java.json`의 `calls` 발췌:

```json
{
  "resolvedMethodId": "java.util.Map#get(java.lang.Object)",
  "responseType": "V",
  "snippet": "fields.get(name)",
  "location": { "line": 12, "column": 50, "endLine": 12, "endColumn": 65 }
}
```

선언 반환형 `V`는 맞고 호출 대상도 정확합니다. 수신자 `Map<String,Object>`를 대입한 실제 호출식 결과 타입은 독립 javac 대조에서 `java.lang.Object`입니다. 현재는 별도의 호출식 결과 타입 필드가 없고 정상 resolver와 fallback의 치환 수준도 다릅니다.

**결정할 계약** — 선언 반환형을 유지하면서 호출식 결과 타입을 별도로 제공할지, 기존 필드의 의미를 바꿀지, 현재 범위를 유지할지 선택합니다. 아직 새 필드명이나 호환 정책을 확정하지 않았습니다.

**검토 질문** — `responseType`은 무엇을 보장해야 하는가? 미해석·raw type·wildcard/capture·외부 타입의 결과는 어떻게 표시할 것인가?

- **사용자 제안** —
- **선택한 계약·적용 범위** —
- **완료 기준 수정·추가** —

**완료 기준 초안 — 선택한 계약에 따라 확정**

- [ ] 선언 반환형과 호출식 결과 타입의 의미, 정상/fallback 경로의 정책과 기존 소비자 호환을 문서화합니다.
- [ ] 78곳을 선택한 정책으로 판정하고, 구체화 결과를 제공하는 경우 독립 javac와 비교합니다. 대상 시그니처·호출 위치는 보존합니다.
- [ ] 해석 불가·wildcard/capture·raw type을 임의의 구체 타입으로 확정하지 않습니다. Class capture 표기 차이 3곳과 리플렉션 capture 2곳은 이 78곳과 구분합니다.
- [ ] 현 범위를 유지하거나 보류한다면 선언형 제공 사실과 호출식 결과형의 미지원 상태가 소비자에게 명확하며, 호출 오연결 78건으로 집계되지 않습니다.

## REVIEW-EXEC-01

**단락 조건 오른쪽 호출의 평가 가드 · 68곳 / 19파일·23메서드**

원본 `src/main/java/demo/bank/QueryEngine.java:10`:

```java
if (id == null || !id.startsWith("DBANK.")) throw new BankException(500,"QUERY_SCOPE","Unknown demo Query ID");
```

실제 `index/java/src/main/java/demo/bank/QueryEngine.java.json`의 `orderedSteps` 발췌:

```json
{
  "kind": "call",
  "snippet": "id.startsWith(\"DBANK.\")",
  "branchPath": [],
  "lineRange": { "startLine": 10, "startColumn": 28, "endLine": 10, "endColumn": 50 },
  "call": { "resolvedMethodId": "java.lang.String#startsWith(java.lang.String)" }
}
```

호출·대상·범위·소스 순서는 맞습니다. `||` 오른쪽은 왼쪽이 false일 때 평가되므로 이 호출은 `id != null`일 때만 평가되지만, 현재 branchPath에는 식 내부 가드가 없습니다. 전체 조건은 raw AST와 상위 snippet에 보존됩니다. 호출 오탐 68건이나 실제 null 역참조 경고로 집계하지 않습니다.

**결정할 범위** — 식 내부 평가 조건을 구조화할지, 소스 순서 요약의 현 범위를 유지하고 제한을 표시할지 선택합니다. 완전한 CFG·변수 null 상태 분석의 도입 여부는 별도 범위입니다.

**검토 질문** — 중첩 `&&/||`를 어떤 형태로 표현하고 소비할 것인가? 해당 가드를 값·null 상태 분석에도 사용할 것인가, 평가 조건만 제공할 것인가?

- **사용자 제안** —
- **선택한 계약·적용 범위** —
- **완료 기준 수정·추가** —

**완료 기준 초안 — 선택한 범위에 따라 확정**

- [ ] 68곳의 호출·대상·범위·원본 순서를 보존하고, 가드 제공 또는 미지원 상태를 선택한 정책대로 확인합니다.
- [ ] 가드를 지원한다면 `&&`는 왼쪽 true, `||`는 왼쪽 false 조건을 나타냅니다. 중첩식·부수 효과·괄호와 비단락 `&/|`를 구별하고 호출을 중복 평가하지 않습니다.
- [ ] 현 범위를 유지하거나 보류한다면 소비자가 가드 없는 call step을 무조건 실행으로 해석하지 않도록 계약·제한을 명시합니다.
- [ ] AUD2-EXEC-02의 조건식 내부 상태 변경과 평가 순서를 함께 검증합니다. 이 항목만으로 완전한 CFG나 NPE 경고 기능이 완료됐다고 판정하지 않습니다.

## REVIEW-DECL-01

**초기화 없는 지역 선언의 표현 계약 · 12개 / 5파일**

원본 `src/main/java/demo/bank/QueryEngine.java:11`:

```java
String sql;
```

실제 `index/java/src/main/java/demo/bank/QueryEngine.java.json`의 `orderedSteps` 발췌:

```json
{
  "kind": "assignment",
  "snippet": "sql",
  "branchPath": ["normal-completion:10:9"],
  "lineRange": { "startLine": 11, "startColumn": 16, "endLine": 11, "endColumn": 18 }
}
```

이 범위는 변수 이름 `sql`의 범위이며 선언 전체는 11행 9–19열입니다. 현재 assignment는 지역 선언을 공용으로 표현하는 분류입니다. 따라서 이 step만으로 값 저장 또는 초기화 성공을 판정할 수 없습니다. 원시 선언과 변수 범위는 보존됩니다.

**결정할 계약** — 선언을 별도 종류로 나눌지, 현재 종류에 초기화 유무 정보를 추가할지, 공용 분류를 유지하고 소비자 계약을 명시할지 선택합니다. 새 kind/필드명을 아직 확정하지 않았습니다.

**검토 질문** — 선언, 초기화 대입, 후속 재대입을 어떻게 구별할 것인가? 초기화되지 않음·null 대입·해석 불가 상태를 각각 표현할 것인가?

- **사용자 제안** —
- **선택한 계약·적용 범위** —
- **완료 기준 수정·추가** —

**완료 기준 초안 — 선택한 계약에 따라 확정**

- [ ] 초기화 없는 12개 선언을 실제 값 대입으로 해석하지 않도록 선택한 분류·정보·제한을 확인합니다. 원본 선언 및 변수의 범위를 보존합니다.
- [ ] 지역 선언 156개의 이름·소유 메서드·범위를 유지하며 초기화 있는 선언·후속 대입·다중 선언·동명 변수 가림을 구별합니다.
- [ ] `String x;`와 `String x = null;`을 동일한 초기화 상태로 간주하지 않습니다. 현재 정보를 유지하는 경우에도 분류의 의미를 명시합니다.
- [ ] 기존 field-write와 필드 선언 37개를 보존하고, 화면·API·보고서가 선택한 의미와 일치합니다.

## 적용 순서와 공통 완료 기준 초안

검토용 순서는 AUD2-IMPORT-01·02 → AUD2-EXEC-01·02입니다. REVIEW 3개 항목은 지원 정책을 먼저 결정하고 관련 구현과 함께 진행할지, 범위 문서만 보완할지, 보류할지 정합니다. 이 순서는 사용자 제안에 따라 바꿀 수 있습니다.

- **사용자 제안·적용 순서** —
- **지원 범위·호환 정책** —
- **추가 보류 항목** —

- [ ] 7개 키에 구현·범위 문서 보완·보류 중 선택한 조치와 완료/미완료 상태를 남깁니다. 체크박스는 계획 승인이나 구현 완료로 미리 표시하지 않습니다.
- [ ] 같은 원본·classpath·Java 버전 설정으로 전체 분석을 다시 실행하고, 항목별 원본·기대/실제 대상 또는 분류·행열·검증 근거를 보존합니다.
- [ ] 기존 117건과 앞선 6개 유형의 완료 기준을 회귀 검증합니다. 타입 43개·메서드/명시적 생성자 108개·필드 37개, 호출 646곳·new 121곳·원시 참조 966곳의 기존 근거와 정확한 타깃을 보존합니다.
- [ ] JSP 27개 파일의 태그 861개·속성 987개·EL 286곳·주석 4개·지시문 45개, 사용자 핸들러 59곳·태그 파일 42곳·함수 44곳, include·HTTP·TASK 관계를 보존합니다.
- [ ] 인덱스·그래프·역색인·보고서·조회 API·상세 메타데이터에서 선택한 계약이 일치합니다. 새로운 필드나 종류가 생기면 전체/증분·캐시 재사용 및 무변경·변경·삭제 시 전달 결과를 비교합니다.
- [ ] 기존 그래프 1,252개나 실행 단계 수를 임의의 고정 목표로 삼지 않습니다. 변경된 근거·단계·링크의 위치별 정확성, 빠진 항목과 중복 여부로 판정합니다.
- [ ] 기존 지원 소스 노드 1,149곳의 범위를 보존합니다. 단계 추가로 순번 ID가 바뀔 수 있으므로 메서드·원본 위치·의미를 기준으로 비교합니다.
- [ ] 관련 성공·모호·미해석·지원 범위 밖 입력을 검증하고, 구현 변경에 맞는 회귀 검사·`pnpm release:check`·Java worker 검사를 통과합니다.

## 보류 및 범위 유지

| 항목 | 상태 |
| --- | --- |
| CMS 데이터가 선택하는 실제 forward 대상 | 보류 유지 |
| SQL·쿼리·파라미터·테이블 연결 | 보류 유지 |
| 메타데이터 기반 리플렉션 실제 대상 연결 | 보류 유지 |
| 애너테이션 의존성 7곳·암시적 super·try-resource의 암시적 close | 기존 지원 범위 메모 유지 |
| 표준 c/fmt 외부 핸들러·useBean 타입·JNDI 설정 관계 | 기존 지원 범위 메모 유지 |
| 완전한 CFG·값/null 상태 분석·런타임/DB 실행 검증 | 이번 7개 항목에 자동 포함하지 않음 |

이 초안을 저장하거나 병합하는 것은 제안의 승인이나 구현 완료를 뜻하지 않습니다. 사용자 제안을 받은 뒤 범위와 완료 기준을 검토합니다. 새 GitHub 이슈는 등록하지 않습니다.
