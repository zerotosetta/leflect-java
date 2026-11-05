# 2026-11-05 재분석 결과의 원본 전수 대조

`rebuild-20261105-103212` 결과를 원본과 다시 대조한 결과, **인덱스·실행 요약에서 보완할 4개 유형**을 확인했습니다. 별도로 표현 범위·계약 확인 3개 유형을 분리했습니다. 미해결 참조 0건이나 기존 회귀 검사 통과만으로 전체 분석에 오탐·누락이 없다고 판정하지 않습니다.

분석기 소스 기준은 `dd0b520`입니다. 원본 입력 84개의 해시가 분석 당시와 일치하며, Java 42개 파일과 JSP 페이지·조각·태그 파일 27개를 각각 독립 도구와 위치별로 대조했습니다. 검수 중 원본·분석기 구현·기존 인덱스/그래프는 수정하지 않았습니다. 이번 보고서는 검수 결과이며, 발견한 항목은 미수정 상태입니다.

## 추가 보완점

| 키 | 유형 | 확인 범위 | 판정 |
| --- | --- | --- | --- |
| AUD2-IMPORT-01 | wildcard import 인덱스의 위치 유실 | 116곳 / 36파일 | 인덱스 메타데이터 누락 |
| AUD2-IMPORT-02 | import 근거의 오연결·누락 | 타입 참조 20레코드 / 5파일, 호출 메타데이터 14레코드 / 2파일; 영향 파일 합집합 6개 | import provenance 오류. 호출 대상 자체는 정확 |
| AUD2-EXEC-01 | continue의 제어 이동·후속 실행 조건 미구조화 | 1곳 | 실행 요약 보완 필요 |
| AUD2-EXEC-02 | 증가 연산의 상태 변경 단계 누락 | 4곳 / 2파일·3메서드 | 실행 요약 보완 필요 |

타입 참조와 호출 메타데이터는 서로 다른 레코드입니다. 같은 코드가 여러 유형의 근거가 될 수도 있으므로 위 건수를 합산하지 않습니다. 실행 요약의 누락은 원시 AST나 호출 그래프에서 코드가 사라졌다는 뜻이 아닙니다.

### AUD2-IMPORT-01 — import 위치 유실

원본 `src/main/java/demo/bank/BankServlet.java:4`:

```java
import javax.servlet.*;
```

원시 `classReferences`의 `import-wildcard`에는 4행 1–23열이 정확히 남습니다. 하지만 `index/java/src/main/java/demo/bank/BankServlet.java.json`의 `importEntries`에는 같은 import 문자열과 ID만 있고 `location`이 없습니다. 명시 import 38개에는 위치가 있고 wildcard import 116개에서만 유실됩니다. import 식별 154개 자체는 모두 보존됐습니다. 패키지 wildcard를 클래스 그래프에 추가하지 않는 현재 정책과는 별개입니다.

### AUD2-IMPORT-02 — import 근거 오연결·누락

원본 `BankServlet.java:4–9`에는 두 선언과 HTTP 타입 사용이 있습니다.

```java
import javax.servlet.*;
import javax.servlet.http.*;
// ...
public final class BankServlet extends HttpServlet {
```

`HttpServlet`의 대상 FQN은 `javax.servlet.http.HttpServlet`로 정확하지만, 참조의 `importId`는 `javax.servlet.*`를 가리킵니다. Java의 패키지 wildcard는 하위 패키지를 가져오지 않으므로 기대 근거는 `javax.servlet.http.*`입니다. `HttpServletRequest`·`HttpServletResponse`도 같습니다.

타입 참조 20개는 오연결 5개(일반 타입 사용 3개·import 선언 2개)와 제네릭 타입의 import 연결 누락 15개로 나뉩니다. 후자는 ServiceLocator 1개·TaskHandler 1개·WBFRecord 13개이며 명시 import가 존재해도 `Map<String,Object>` 같은 타입에 `importId`가 없습니다. 같은 원인으로 호출 메타데이터 14개(BankServlet 13개·TaskTag 1개)도 잘못된 상위 패키지 wildcard를 가리킵니다. 원시 호출 646곳의 실제 대상 시그니처는 모두 정확합니다.

전체 타입 참조 966개와 호출 646개의 import 정보를 확인했습니다. 호출 199개의 `importId` 미제공과 wildcard 선언 114개의 self-ID 미제공은 수신자·상속·암시적 타입의 provenance 계약이 명확하지 않아 추가 누락으로 추정하지 않았습니다. FQN 직접 표기 5곳에 import 링크가 없는 것은 정상입니다.

### AUD2-EXEC-01 — continue의 효과 누락

원본 `src/main/java/demo/bank/Cms.java:59–61`:

```java
if(step>0 && "content".equals(area)) continue;
if(!page.areas.containsKey(area)) throw new BankException(500,"CMS_AREA","Unknown area: "+area);
page.areas.get(area).add(component(c,overrides.containsKey(id)?overrides.get(id):id,page));
```

원시 AST와 상위 branch의 snippet에는 `continue`가 보존됩니다. 하지만 59행 58–66열의 독립 제어 이동 단계가 없고, 60–61행의 단계에는 해당 반복 건이 `continue`하지 않았다는 후속 실행 조건이 없습니다. 구조화된 `orderedSteps/branchPath`만 소비하면 반복 건을 건너뛰는 효과를 잃습니다. CMS 데이터가 선택하는 실제 forward 대상 연결 보류와는 별개의 국소 제어 표현 문제입니다.

### AUD2-EXEC-02 — 증가 연산의 상태 변경 누락

원본 `src/main/java/demo/bank/QueryEngine.java:33`:

```java
if(position!=next++ || !input.hasField(field)) throw new BankException(500,"QUERY_PARAM","Missing parameter: " + field);
```

`next++`는 현재 값을 비교에 쓰고 이후 값을 증가시킵니다. 원시 AST와 상위 snippet에는 남지만, `orderedSteps`에는 이 상태 변경 이벤트가 없습니다. 같은 범위는 QueryEngine 17·33·46행과 `callees/DepositOpen.java:18`의 총 4곳입니다. for 루프의 갱신식과 조건식 안의 부수 효과를 구조화된 상태 추적에 사용할 때 보완이 필요합니다.

## 확정 보완 건수에서 분리한 표현 범위·계약

| 키 | 관찰 | 범위 | 분리한 이유 |
| --- | --- | --- | --- |
| REVIEW-TYPE-01 | 구체화된 제네릭 호출식 결과 타입 미제공 | 78곳 / 26파일 | `responseType`이 선언 반환형인지 호출식 결과형인지 계약이 불명확. 선언형 자체와 대상은 맞음 |
| REVIEW-EXEC-01 | 단락 조건 오른쪽 호출의 평가 가드 미제공 | 68곳 / 19파일·23메서드 | 호출·대상·범위·소스 순서는 정확. 현재 요약은 완전한 CFG가 아님 |
| REVIEW-DECL-01 | 초기화 없는 지역 선언도 assignment로 공용 분류 | 12개 / 5파일 | 현 분류는 지역 선언을 함께 표현함. 실제 값 저장이나 초기화 성공의 증거로 해석하면 안 됨 |

예를 들어 `WBFRecord.java:12`의 `fields.get(name)`은 구체적인 호출식 결과 타입이 Object이지만 `responseType`에는 선언 반환형 `V`가 저장됩니다. 정상 resolver와 fallback의 치환 수준도 달라, 선언 타입과 호출식 결과 타입을 별도 필드로 제공할지 결정해야 합니다. Class capture의 단순 표기 차이 3곳과 리플렉션 capture 2곳은 이 78곳에 넣지 않았습니다.

`QueryEngine.java:10`의 `id == null || !id.startsWith("DBANK.")`에서 `startsWith` 호출은 원시 AST와 호출 단계에 정확히 있습니다. 다만 `branchPath`에 `id != null`이라는 식 내부 평가 조건을 제공하지 않습니다. 이를 호출 오탐 68건이나 실제 null 역참조 경고로 집계하지 않았습니다.

`QueryEngine.java:11`의 `String sql;`은 `kind: assignment`, `snippet: sql`로 표현됩니다. 이 kind만으로 변수에 값이 대입됐다고 판정할 수 없습니다.

## 일치한 영역과 검사 방법

- Java: fresh `javac --release 8`로 타입 43개·메서드/명시적 생성자 108개·필드 37개·상속 28곳·호출 646곳·new 121곳·타입 사용 811곳을 대조했습니다. 원시 참조 966곳은 모두 원본 근거가 있습니다. import 식별 154개는 보존됐고 위치·근거 문제는 위에서 별도 집계했습니다.
- 실행 요약: 현재 지원하는 소스 노드 1,149곳의 범위, 108개 메서드의 callTargets와 중첩 호출 순서, 지역 선언 156개의 위치가 일치했습니다. 지원 노드 일치는 모든 제어·상태 변화를 표현했다는 뜻이 아닙니다.
- JSP 27개: 태그 861개·속성 987개·EL 286곳·주석 4개·지시문 45개의 원문·전체 범위·부모 관계가 일치했습니다. Tomcat ELParser로 EL AST 286곳을 독립 비교했습니다. 제어 노드 66개와 TLD 선언·태그/함수 해석도 확인했습니다.
- JSP 연결: 사용자 핸들러 59곳·태그 파일 42곳·함수 44곳, include 23곳(지시문 17·고정 액션 4·동적 2), param 4개·useBean 1개를 확인했습니다. 새 JSP 오탐·누락은 확인되지 않았습니다.
- 그래프/보고서: 파일 그래프 1,252개 레코드, 69개 파일의 정·역참조, 역색인 6종, 27개 JSP 영향 조회, Java 사용 대상 95개 및 69개 파일 상세의 원본 미리보기 대조가 통과했습니다. 이는 위의 importId·실행 요약 문제를 상쇄하는 검사가 아닙니다.

평면 `index.tags` 290개의 raw/location은 태그 이름 뒤 구분문자 하나까지인 참조 토큰입니다. 예를 들어 `<bank:csrf/`는 전체 시작 태그의 잘린 오탐이 아니라 현재 평면 참조 범위입니다. 전체 태그 원문·범위는 구조/의미 AST에 보존되어 있어 추가 결함으로 집계하지 않았습니다.

## 검수 근거와 한계

- [전체 유형 및 위치별 원본·기대/실제 JSON](findings.json)
- [파일·메서드별 대조 범위와 정상 검사 근거](coverage.json)
- [앞선 클린 빌드·재분석 회귀 검사](../legacy-bank-java8-rebuild-20261105/README.md)

로컬 세부 자료는 `analysis/legacy-bank-java8/rebuild-20261105-103212/source-audit/`에 있습니다. Java 심볼·실행 요약·JSP·그래프/보고서를 나누어 저장했고 독립 추출기·검수 스크립트도 함께 남겼습니다. 공개 JSON은 개인 PC 경로를 치환했습니다.

CMS 실제 forward 대상, SQL·쿼리 연결, 메타데이터 기반 리플렉션 연결은 보류를 유지합니다. 애너테이션 의존성 7곳·암시적 super·try-resource의 암시적 close, 표준 c/fmt 외부 핸들러·useBean 타입·JNDI 설정 관계 등 기존 지원 범위 메모도 새 결함 수에 넣지 않았습니다. Java/JSP 외 입력은 해시를 확인했으며 DB·CSS 의미나 런타임 동작을 검증한 것은 아닙니다. 애플리케이션·DB 실행 및 브라우저 시각 검사는 하지 않았고 새 GitHub 이슈도 등록하지 않았습니다.
