# 원본 전수 대조 후속 수정 계획서 · 완성 초안

상태: **이전 제안의 기조를 반영한 작성자 완성안 · 구현 전**. 사용자 요청에 따라 보완 4개 유형과 지원 범위·계약 확인 3개 항목의 처리안·출력 계약·완료 기준을 모두 채웠습니다. 기존 검수 키를 유지합니다. 아래 세부 설계는 이전 방향에 맞춰 작성한 권고안이며, 사용자에게 이미 승인받은 구현 결정으로 간주하지 않습니다. 체크박스는 구현·검증 전이므로 미완료 상태입니다.

기준은 `legacy-bank-java8`의 `rebuild-20261105-103212`, 분석기 소스 `dd0b520`입니다. 원본 입력 84개의 해시가 분석 당시와 일치합니다. 아래 `src/...`는 원본 프로젝트 기준 경로이고, `index/...`·`java-ast/...`는 해당 분석 결과 디렉터리 기준 경로입니다. 코드와 JSON은 실제 자료에서 필요한 부분만 발췌했습니다. 제안하는 새 출력 필드를 현재 분석 결과처럼 표시하지 않았습니다.

- [원본 전수 대조 보고서](../audits/legacy-bank-java8-source-audit-20261105/README.md)
- [모든 발견 위치의 원본·기대/실제 결과](../audits/legacy-bank-java8-source-audit-20261105/findings.json)
- [파일·메서드별 검수 범위](../audits/legacy-bank-java8-source-audit-20261105/coverage.json)

## 반영한 이전 제안과 이번 작성자안

이전 댓글에서 명시한 방향은 의존성 해석과 실제 대상 연결, classpath·environment를 이용한 실제 시그니처 확인, CFG를 통한 실행 경로·값 상태 추적, 주석/스크립틀릿처럼 서로 다른 요소의 정확한 분류, 대상 버전의 표준 소스에 근거한 API 설명이었습니다. 이후 계획에서는 TASK CODE 도출을 통합하고 CMS·쿼리·리플렉션 실제 연결을 보류했습니다.

이번에는 그 방향을 다음과 같이 구체화합니다. 새 필드명·호환 방식·단계 경계는 **이번 작성자 제안**입니다.

| 이전 기조 | 이번 문서의 적용안 |
| --- | --- |
| 의존성을 해석하고 실제 참조에 연결 | AST·심볼·원본 표기를 근거로 import를 연결하고 근거 없는 패키지 추측을 제거 |
| classpath/environment로 실제 시그니처 확인 | 선언 반환형과 구체화된 호출식 결과 타입을 함께 제공하고 해석 상태·근거를 표시 |
| 실행 경로와 값 상태 추적 | 메서드 내부 CFG·식 평가 가드·제어 이동·상태 변경·초기화 상태를 구조화 |
| 요소 유형을 정확히 분류 | 선언·초기화·후속 대입·증감 연산을 구별하고 원문·위치·소유 심볼을 보존 |
| 표준 소스의 API 주석으로 설명 | 기존 버전 일치 소스 archive/Javadoc 정책을 유지하고, 문서 미제공을 타입 해석 실패와 구분 |
| 실제 코드와 분석 결과로 완료 판정 | 기존 위치별 근거를 보존하고 새 계약의 원본·인덱스·API·보고서·전체/증분 결과를 대조 |

이전 수정안은 null 역참조 경고를 별도 기능으로 분리했습니다. 이번 권고안은 그 기반인 **메서드 내부 흐름과 상태 표현**까지 구체화합니다. 모든 Java의 메서드 간 CFG나 자동 NPE 경고가 이미 합의·구현된 것으로 확대하지 않습니다.

| 키 | 항목 | 기준 범위 | 현재 판정 | 작성자 처리안 |
| --- | --- | --- | --- | --- |
| [AUD2-IMPORT-01](#aud2-import-01) | wildcard import의 인덱스 위치 유실 | 116곳 / 36파일 | 확정 메타데이터 누락 | AST 선언과 공통 키로 위치 전달 |
| [AUD2-IMPORT-02](#aud2-import-02) | import 근거 오연결·누락 | 타입 참조 20레코드 / 5파일, 호출 메타데이터 14레코드 / 2파일 | 확정 메타데이터 보완 | 실제 이름 해석과 출처로 연결 |
| [AUD2-EXEC-01](#aud2-exec-01) | continue 제어 이동·후속 실행 조건 | 1곳 | 확정 구조화 요약 누락 | 소유 반복문·CFG 이동·finally 경로 표현 |
| [AUD2-EXEC-02](#aud2-exec-02) | 증가 연산의 상태 변경 단계 | 4곳 / 2파일·3메서드 | 확정 구조화 요약 누락 | 대상 심볼·전위/후위·평가 순서 표현 |
| [REVIEW-TYPE-01](#review-type-01) | 제네릭 호출식 결과 타입 | 78곳 / 26파일 | 출력 계약 확인 | 선언형/호출식 타입 분리, 기존 필드 호환 |
| [REVIEW-EXEC-01](#review-exec-01) | 단락 조건의 평가 가드 | 68곳 / 19파일·23메서드 | 지원 범위 확인 | AST 기반 가드를 메서드 내부 CFG에 연결 |
| [REVIEW-DECL-01](#review-decl-01) | 초기화 없는 선언의 분류 | 12개 / 5파일 | 표현 계약 확인 | 선언/쓰기 구분과 심볼별 초기화 상태 제공 |

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

**처리 제안 — 작성자안**

원시 ImportDeclaration을 기준으로 파일·선언 이름·static 여부·wildcard 여부를 동일한 키로 정규화합니다. worker가 보존한 전체 선언 범위를 그 키에 연결하고 인덱스와 상세 조회까지 전달합니다. `javax.servlet`와 `javax.servlet.*`의 표기 차이 때문에 위치를 놓치지 않도록 선언 키 생성과 조회를 공유합니다.

기존 import ID와 원문 표기는 유지하고 `location`을 보완합니다. 위치를 찾지 못한 경우에는 다른 선언의 위치로 대신하지 않고 해당 선언과 누락 사유를 기록합니다. wildcard는 패키지 선언으로 유지하고 이 작업을 이유로 클래스 그래프에 패키지 노드를 추가하지 않습니다.

**완료 기준 초안**

- [ ] 116개 wildcard import의 파일·시작/종료 행·열이 원본 및 원시 참조와 일치하고 `importEntries`에서 확인됩니다.
- [ ] 기존 154개 import의 ID·표기와 명시 import 38개의 위치를 보존하며 다른 선언에 위치를 붙이거나 중복 생성하지 않습니다.
- [ ] 일반·wildcard·static import의 표기 차이를 회귀 검증합니다. 이 수정만으로 패키지를 타입 그래프에 추가하지 않습니다.
- [ ] 인덱스와 상세 API의 위치가 같고, 위치를 얻지 못한 입력은 원본 선언·사유를 확인할 수 있습니다.

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

**처리 제안 — 작성자안**

`importId`는 실제 소스의 이름 해석을 뒷받침하는 선언에 연결합니다. classpath/environment로 확정한 타입 FQN은 유지하고, 원본의 타입 표기·기저 타입·선언 소유 관계를 이용해 근거를 찾습니다. 명시 import와 wildcard를 구별하고 wildcard의 패키지는 직접 소속 타입에만 적용합니다. 중첩 타입은 패키지 문자열 길이로 추정하지 않고 외부 타입의 선언 관계를 확인합니다. 제네릭 인자는 실제 타입 정보로 보존하며 import 검색에는 기저 타입을 사용합니다.

import 선언 자체의 원시 참조는 **자기 선언 ID**를 가리키도록 통일합니다. 기존 self-ID 미제공 114개는 새 계약으로 채우는 대상이며, 과거에 확정 결함 114건을 추가 발견한 것으로 소급 집계하지 않습니다.

호출은 수신자·정적 소유 타입의 실제 선언 출처를 확인합니다. 매개변수/필드 등 수신자 선언에서 같은 파일의 import로 이어지는 근거가 있으면 연결하고, 상속·다른 파일·암시적 타입이면 그 출처를 별도로 기록합니다. 대상 클래스가 우연히 wildcard 문자열 아래에 있다는 이유만으로 현재 파일의 import를 붙이지 않습니다. 근거가 여러 개이거나 불명확하면 후보·상태·사유를 남기고 임의로 한 ID를 확정하지 않습니다.

출처 종류와 원본 위치를 추가해 명시 import·wildcard·완전 수식명·같은 패키지·java.lang·수신자 선언·상속·미해석을 구별합니다. 기존 `importId`는 단일 근거가 확정된 경우의 호환 필드로 유지합니다.

**완료 기준 초안**

- [ ] 타입 참조 20개와 호출 메타데이터 14개를 각각 원본·기대 import 선언에 대조합니다. 원래 정확했던 타입 FQN·호출 대상·범위를 보존합니다.
- [ ] 패키지 wildcard가 하위 패키지에 잘못 적용되지 않고, 제네릭 기저 타입·명시 import·중첩 타입 등 이름 해석 차이를 회귀 검증합니다.
- [ ] FQN 직접 표기 5곳, 같은 패키지·java.lang·지역 타입을 임의의 import에 귀속하지 않습니다. 불명확하거나 모호한 근거를 임의로 확정하지 않습니다.
- [ ] import 선언 154개의 원시 참조가 자기 선언 ID와 대응합니다. self-ID 미제공 114개의 보완은 새 계약 적용으로 따로 기록합니다.
- [ ] importId 없는 호출 199개를 선언 출처 정책으로 판정합니다. 연결할 선언이 없거나 확정되지 않으면 출처 종류·상태·사유를 남기며, 전부 누락으로 집계하지 않습니다.
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

**처리 제안 — 작성자안**

continue를 독립 제어 이동으로 기록하고 메서드 내부 CFG에서 실제 소유 반복문으로 연결합니다. while/do-while은 다음 조건 평가, 일반 for는 갱신식 후 조건 평가, 향상된 for는 다음 원소 진행으로 이동합니다. label이 있으면 label이 가리키는 반복문을 AST 소유 관계로 찾습니다.

분기에서 continue가 선택되면 현재 반복의 나머지 본문으로 가는 간선을 만들지 않습니다. continue하지 않은 경로는 후속 호출에 이어지도록 표현합니다. 새 실행 모델의 단계와 `branchPath`를 CFG 노드·조건에 대응시켜 60–61행의 실행 조건을 확인할 수 있게 합니다. 기존 형식의 단계에는 대응 관계를 호환 투영합니다.

try/finally를 통과하는 이동은 finally 실행 뒤 원래 이동을 수행하도록 표현합니다. finally 안에서 return/throw 등 다른 제어 이동이 발생하면 그 효과를 반영합니다. 의미를 구성할 수 없는 문법은 완성된 흐름처럼 표시하지 않고 해당 메서드의 부분 지원 상태와 위치를 남깁니다.

**완료 기준 초안**

- [ ] 현재 1곳의 원본 범위·소유 메서드·소유 반복문과 continue 효과가 구조화된 결과에서 확인됩니다.
- [ ] continue가 선택된 반복 건에서 60–61행이 무조건 실행되는 것으로 나타나지 않습니다. 정상 진행 경로와 반복 종료를 구분합니다.
- [ ] while/for/do-while/향상된 for의 이동 지점, 중첩 반복문·label, finally를 통과하거나 finally에서 재지정되는 이동을 fixture로 검증합니다. 지원되지 않는 형태는 위치와 함께 부분 지원으로 표시합니다.
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

**처리 제안 — 작성자안**

`++/--`를 별도 상태 변경 단계로 만들고 대상 심볼, 연산자, 전위/후위, 식의 결과가 변경 전 값인지 변경 후 값인지, 원본 범위를 기록합니다. 지역 변수·필드는 소유 범위가 있는 심볼 ID로 연결하고 필드 수신자와 배열의 수신자/인덱스 식도 보존합니다.

전위 연산은 변경 후 값, 후위 연산은 변경 전 값을 바깥 식에 전달하도록 평가 관계를 표현합니다. 실제 수치 계산을 수행한 것으로 가정하지 않고, 우선 읽기·쓰기·결과값의 관계와 순서를 제공합니다. 부수 효과가 있는 수신자나 인덱스 식은 한 번 평가한 결과를 참조합니다.

for 갱신식은 본문 정상 종료 및 해당 for를 대상으로 하는 continue 뒤에 연결합니다. 조건식 내부 증감은 단락 평가 가드와 함께 현재 위치에 배치합니다. 같은 효과를 별도 assignment/field-write로 다시 생성해 중복 집계하지 않습니다.

**완료 기준 초안**

- [ ] 실제 4곳의 연산·대상·범위와 상태 변경이 구조화된 결과에서 확인되며 기존 호출·분기와 원본 평가 순서가 일치합니다.
- [ ] 전위/후위, 증가/감소, 지역 변수·필드·배열 대상을 구별하고 부수 효과가 있는 수신자·인덱스를 중복 평가하지 않습니다. 해석할 수 없는 대상은 심볼·상태·사유를 구분합니다.
- [ ] for 갱신은 본문 뒤에 적용되고, continue 시의 갱신 경로도 AUD2-EXEC-01과 함께 검증합니다. 조건식 내부 연산은 원래 위치와 순서를 유지합니다.
- [ ] 기존 대입·필드 쓰기와 중복 집계하지 않고, 연산 결과의 변경 전/후 관계가 상세 API에 표시됩니다. 구체 수치 계산을 제공하지 않는 범위도 명시합니다.

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

**처리 제안 — 작성자안**

선언 반환형과 실제 호출식 결과 타입을 **별도 필드로 제공**합니다. 새 계약의 제안 필드명은 `declaredReturnType`, `expressionType`, `expressionTypeStatus`이며 현재 분석 결과에 이미 있는 필드가 아닙니다. `declaredReturnType`은 메서드 선언의 타입 변수까지 보존하고, `expressionType`은 수신자·인자·호출 문맥을 적용한 호출식 타입을 제공합니다. 정상 resolver와 fallback 모두 같은 계약을 적용합니다.

예시의 목표는 선언형 `V`, 호출식 타입 `java.lang.Object`를 함께 확인하는 것입니다. 기존 `responseType`은 0.1.8 형식의 호환용 값으로 유지하고 의미를 조용히 바꾸지 않습니다. 새 값/리소스 추적 소비자는 해석된 `expressionType`을 우선 사용하고, 없으면 선언형과 미해석 상태를 함께 표시합니다. 기존 결과 파일에는 새 필드가 없을 수 있으므로 읽을 수는 있어도 구체 타입이 해석됐다고 간주하지 않습니다.

`expressionTypeStatus`는 resolved/partial/unresolved/not-applicable로 나누고 근거·진단을 남깁니다. wildcard/capture·raw type·상한만 알려진 타입은 가능한 정보를 보존합니다. 단순히 Object로 대체해 해석 성공으로 만들지 않습니다. void 메서드 호출은 해석된 void 타입으로 기록하고, 호출식이 아닌 명시적 생성자 위임에는 호출식 타입을 넣지 않고 not-applicable로 표시합니다. API 설명은 동일한 실제 대상 시그니처와 대상 버전의 소스/Javadoc에 연결하고, 문서 미제공 상태는 타입 해석 상태와 별도로 유지합니다.

**완료 기준 초안**

- [ ] 선언 반환형·호출식 결과 타입·해석 상태의 의미가 정상/fallback 경로, 인덱스·API·소비자에서 일치합니다. 기존 `responseType` 값과 읽기 호환을 보존합니다.
- [ ] 기준 78곳의 호출식 타입은 동일한 분석 환경의 독립 javac 결과와 일치하고 해석 성공으로 확인됩니다. 이 78곳을 일괄 partial/unresolved로 남겨 완료로 판정하지 않습니다. 다른 입력에서 완전히 구체화할 수 없으면 남아 있는 타입과 해석 상태를 보존합니다.
- [ ] 해석 불가·wildcard/capture·raw type을 임의의 구체 타입으로 확정하지 않습니다. Class capture 표기 차이 3곳과 리플렉션 capture 2곳은 이 78곳과 구분합니다.
- [ ] capture의 컴파일러 생성 이름만 달라진 경우에는 경계·타입 구조를 비교하며 문자열 차이만으로 오해석으로 집계하지 않습니다.
- [ ] `WBFRecord.getField`에서 선언형 V와 호출식 Object를 함께 확인합니다. 기존 78곳을 호출 오연결로 소급 집계하지 않습니다.
- [ ] 구형 결과의 새 필드 미제공, 외부 라이브러리·void·명시적 생성자 위임을 검증하며 API 소스 설명의 제공 여부가 타입 해석 성공을 바꾸지 않습니다.

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

**처리 제안 — 작성자안**

단락 평가 가드를 **구조화해 제공**하고 메서드 내부 CFG의 조건 간선과 연결합니다. AST의 왼쪽 식·오른쪽 식·연산자를 근거로 `&&`의 오른쪽에는 왼쪽 true, `||`의 오른쪽에는 왼쪽 false 조건을 붙입니다. 가드는 원본 식 ID·범위와 요구 진릿값을 기록하고, 중첩식은 평가 순서에 맞춰 조합합니다. 문자열 검색으로 조건을 재해석하지 않습니다.

예시의 `id.startsWith`는 `id == null`이 false인 간선을 따라 실행되며, 화면에는 `id != null` 조건으로 설명할 수 있습니다. 원래 호출 노드는 한 번만 만들고 다른 경로가 같은 호출을 가리킬 때 참조로 연결합니다. `&/|`는 단락 연산자로 취급하지 않습니다.

`branchPath`는 호환 표시로 유지하고 새 실행 모델의 단계에 CFG 노드·가드 참조를 추가합니다. 가드 없음, 항상 실행, 미지원/미해석을 구별하며 구형 결과의 빈 branchPath를 항상 실행으로 간주하지 않습니다. null 검사에서 직접 증명되는 상태는 해당 경로에서만 사용하고 재대입·합류 뒤에는 다시 평가합니다. 일반적인 NPE 경고 생성은 별도 후속 단계입니다.

**완료 기준 초안**

- [ ] 68곳의 호출·대상·범위·원본 순서를 보존하며 각 오른쪽 호출에서 필요한 평가 가드와 CFG 간선을 확인합니다.
- [ ] `&&`/`||`, 중첩·괄호·부정·부수 효과·비단락 `&/|`를 구별하고 조건/호출을 중복 평가하지 않습니다.
- [ ] 예시의 null 경로에서는 startsWith로 진행하지 않고 비null 경로에서만 진행합니다. branchPath와 구조화 가드가 모순되지 않습니다.
- [ ] 미지원·미해석·구형 결과를 항상 실행이나 안전으로 표시하지 않습니다. 경로 합류·재대입 후 가드가 계속 유효하다고 잘못 확정하지 않습니다.
- [ ] AUD2-EXEC-02의 조건식 내부 상태 변경과 평가 순서를 함께 검증합니다. 과거의 68곳을 호출 오탐으로 집계하지 않으며, 이 단계의 완료를 자동 NPE 경고 완료로 표시하지 않습니다.

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

**처리 제안 — 작성자안**

지역 선언은 별도 `declaration` 종류로 분리하고 소유 메서드·블록을 포함한 변수 심볼 ID, 선언 타입, 초기화 식의 유무와 범위를 보존합니다. 초기화가 있으면 선언 이후의 초기화 쓰기를 별도 효과로 연결하고, 후속 재대입은 assignment로 표현합니다. 변수 선언과 값 저장의 건수를 따로 집계합니다.

초기화 상태와 null 상태는 별도 차원으로 관리합니다. 초기화는 uninitialized/initialized/maybe-uninitialized/unknown, 참조의 null 상태는 null/non-null/maybe-null/unknown으로 제안합니다. primitive에는 null 상태가 적용되지 않음을 표시합니다. `String x;`는 미초기화, `String x = null;`은 초기화됨+null입니다. null·new·검증 가능한 null 검사에서 얻은 근거만 전파하고 외부 반환값이나 근거가 없는 상태는 unknown으로 남깁니다.

분기 합류에서는 한 경로만 초기화한 변수를 항상 초기화됨으로 만들지 않습니다. 심볼 ID로 가림을 구별하고 필드 수신자·배열 등 명확한 별칭 관계가 없는 저장소까지 상태를 추정해 확산하지 않습니다. 향상된 for·catch·매개변수의 초기 바인딩도 일반적인 미초기화 지역 선언과 구별합니다.

새 실행 모델에서는 declaration을 기본 표시합니다. 기존 결과의 assignment 공용 표현은 원시 선언과 대응할 근거가 있으면 버전 어댑터로 구분하고, 근거가 없으면 초기화 상태를 unknown으로 읽습니다. 새 결과의 기존 형식 투영도 제공하되 assignment만으로 초기화 성공을 단정하지 않습니다.

**완료 기준 초안**

- [ ] 초기화 없는 12개 선언이 declaration과 미초기화 상태로 확인되며 값 대입으로 집계되지 않습니다. 원본 선언 및 변수의 서로 다른 범위를 보존합니다.
- [ ] 지역 선언 156개의 이름·소유 메서드·범위를 유지하며 초기화 있는 선언·후속 대입·다중 선언·동명 변수 가림·초기 바인딩을 구별합니다.
- [ ] `String x;`와 `String x = null;`의 초기화/null 상태를 구별합니다. 한쪽 분기만 초기화하는 합류, null 검사 뒤 재대입, 외부 반환 unknown을 검증합니다.
- [ ] 기존 field-write와 필드 선언 37개를 보존하며 새 모델·구형 어댑터·화면·API·보고서의 의미가 일치합니다. 별칭이나 다른 메서드의 효과를 근거 없이 확정하지 않습니다.

## 공통 실행 모델과 호환 계약 — 작성자안

아래는 새로 구현할 계약의 제안이며 현재 분석 JSON을 설명하는 필드가 아닙니다.

| 제안 데이터 | 책임 |
| --- | --- |
| 메서드의 `executionModel`(version 2) | 새 단계·CFG·심볼 상태·지원 상태를 기존 형식과 구별해 보관 |
| `executionModel.flowGraph` | entry/exit·평가/제어 노드·조건/정상/예외/반복 간선과 원본 범위·소유 관계 |
| 새 단계의 CFG 노드·가드 참조 | `executionModel.orderedSteps`·branchPath를 실제 조건/실행 경로와 대응시키고 표시와 분석을 일치 |
| 상태 변경 효과·선언 심볼 | 증감·초기화·재대입의 대상·읽기/쓰기·결과값 관계를 변수 이름 대신 심볼로 추적 |
| 실행 모델 버전·지원 상태 | 구형 결과, complete/partial, 미지원 노드·미해석·분석 한계와 위치를 구별 |

초기 목표는 Java 8의 **명시적인 소스 동작에 대한 메서드 내부 흐름**입니다. 현재 입력의 분기·삼항·반복·try/catch·synchronized·return/throw와 이번 continue/증감·단락/선언을 같은 모델로 연결합니다. 명시적 예외 흐름과 finally를 표현하고, 호출의 예외·효과를 확정하지 못하면 가능 경로 또는 unknown으로 남깁니다. 지원하지 않는 문법이 있으면 해당 메서드의 지원 상태를 partial로 표시합니다. complete는 정의한 소스 범위 안에서의 완성을 뜻하며 런타임 모든 경로를 증명했다는 의미가 아닙니다.

반복은 CFG의 순환으로 보존하고 실행 횟수만큼 노드를 복제하지 않습니다. 상태 합류는 유한한 상태 값으로 반복 계산하며, 한계에 도달하면 unknown/partial과 근거를 남깁니다. lambda·내부 클래스·다른 메서드 본문을 현재 메서드의 단계로 섞지 않습니다.

0.1.8의 기존 `orderedSteps`·`branchPath`는 legacy 형식으로 유지하고, 새 의미의 단계와 상태는 별도 `executionModel.version=2` 아래에 제공합니다. 새 화면/API는 v2를 우선 사용하며, 기존 형식은 의미가 바뀌지 않는 호환 투영으로 제공합니다. legacy 투영이 CFG·상태 분석의 완성 결과라는 보장은 하지 않습니다. 구형 결과는 계속 읽되 근거 없이 새 상태를 채우지 않습니다.

`responseType`, 메서드·타입·import ID 및 원본 범위는 보존하고 새 필드를 전달합니다. 실행 단계 순번 ID는 추가 단계 때문에 바뀔 수 있으므로 메서드·원본 위치·역할로 대응합니다. worker 요약·인덱스의 스키마/캐시 버전을 갱신해 오래된 캐시가 새 계약의 완성 결과로 재사용되지 않도록 합니다. 이 문서 변경으로 배포 준비 버전 0.1.8을 올리거나 npm을 게시하지 않습니다.

## 적용 순서와 공통 완료 기준 초안

| 단계 | 항목 | 완료 산출물 |
| --- | --- | --- |
| 1 | AUD2-IMPORT-01·02 | 선언 키·위치·import 근거 및 진단 일치 |
| 2 | REVIEW-TYPE-01·REVIEW-DECL-01 | 타입·선언·심볼·상태 계약과 구형 데이터 어댑터 |
| 3 | REVIEW-EXEC-01·AUD2-EXEC-01·02 | 공유 평가기·메서드 내부 CFG·가드·제어 이동·상태 변경 연결 |
| 4 | 7개 항목 공통 | 화면/API/보고서 일치, 실제 원본 재분석·전체/증분 및 회귀 검증 |

단계 3의 continue와 증감은 for 갱신·finally·단락 조건이 맞물리므로 같은 회귀 묶음으로 검증합니다. 각 키의 구현 커밋과 완료 판정은 따로 남깁니다. 기존 코드/JSON은 수정 전 근거로 보존하고 새 결과를 나란히 추가합니다.

- [ ] 7개 키의 처리안과 출력 계약을 구현·문서에 반영하고 실제 검증 후 완료/미완료를 기록합니다. 이 초안의 저장·병합을 사용자 승인이나 구현 완료로 표시하지 않습니다.
- [ ] 같은 원본·classpath·Java 버전 설정으로 전체 분석을 다시 실행하고, 항목별 원본·기대/실제 대상 또는 분류·행열·검증 근거를 보존합니다.
- [ ] 기존 117건과 앞선 6개 유형의 완료 기준을 회귀 검증합니다. 타입 43개·메서드/명시적 생성자 108개·필드 37개, 호출 646곳·new 121곳·원시 참조 966곳의 기존 근거와 정확한 타깃을 보존합니다.
- [ ] JSP 27개 파일의 태그 861개·속성 987개·EL 286곳·주석 4개·지시문 45개, 사용자 핸들러 59곳·태그 파일 42곳·함수 44곳, include·HTTP·TASK 관계를 보존합니다.
- [ ] 인덱스·그래프·역색인·보고서·조회 API·상세 메타데이터에서 새 계약과 호환 어댑터의 의미가 일치합니다. 새 필드·종류·모델 버전에 대해 전체/증분·캐시 무효화·무변경·변경·삭제 결과를 비교합니다.
- [ ] 기존 그래프 1,252개나 실행 단계 수를 임의의 고정 목표로 삼지 않습니다. 변경된 근거·단계·링크의 위치별 정확성, 빠진 항목과 중복 여부로 판정합니다.
- [ ] 기존 지원 소스 노드 1,149곳의 범위를 보존합니다. 단계 추가로 순번 ID가 바뀔 수 있으므로 메서드·원본 위치·의미를 기준으로 비교합니다.
- [ ] 이번에 처리하기로 한 실제 import·continue·증감·단락·선언 위치는 근거 있는 연결/흐름/상태로 확인합니다. 현재 수정 대상을 전부 부분 지원으로 돌려 완료로 판정하지 않습니다.
- [ ] 관련 성공·모호·미해석·지원 범위 밖 입력을 검증하고, 구현 변경에 맞는 회귀 검사·`pnpm release:check`·Java worker 검사를 통과합니다.
- [ ] 대상 버전의 소스/Javadoc이 있으면 기존 API 설명·출처를 유지합니다. 소스 미제공·미발견·버전 불일치는 해석 실패와 구분하고 다른 버전 설명으로 대신하지 않습니다.

## 보류 및 범위 유지

| 항목 | 상태 |
| --- | --- |
| CMS 데이터가 선택하는 실제 forward 대상 | 보류 유지 |
| SQL·쿼리·파라미터·테이블 연결 | 보류 유지 |
| 메타데이터 기반 리플렉션 실제 대상 연결 | 보류 유지 |
| 애너테이션 의존성 7곳·암시적 super·try-resource의 암시적 close | 기존 지원 범위 메모 유지 |
| 표준 c/fmt 외부 핸들러·useBean 타입·JNDI 설정 관계 | 기존 지원 범위 메모 유지 |
| 메서드 내부 CFG·평가 가드·기본 초기화/null 상태 | 이번 작성자안의 구현 범위 |
| 모든 메서드 간 CFG·임의 값 계산·전체 heap 별칭 분석 | 별도 후속 범위 |
| 일반 NPE 경고·런타임/DB 실행 검증 | 별도 후속 범위 |

null 역참조 경고를 후속으로 추가할 때는 Nullable/NonNull 등 상태의 근거, 검사와 재대입, 합류, 경고가 발생한 실제 경로를 함께 보여주는 방향을 유지합니다. 현재 68개 단락 호출을 NPE 경고로 바꾸지 않습니다. 버전별 표준 소스를 제품에 내장하는 범위도 기존 source archive/출처 정책을 넘어 자동 확대하지 않습니다.

이 문서는 7개 항목의 빈 제안란을 채운 **검토용 완성 초안**입니다. 세부 계약은 작성자 권고안이며 이번 작업에서는 구현을 시작하지 않습니다. 새 GitHub 이슈·npm 게시·배포 태그도 만들지 않습니다.
