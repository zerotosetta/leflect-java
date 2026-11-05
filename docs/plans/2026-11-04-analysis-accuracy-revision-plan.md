# 분석 정확도 추가 수정 계획서 · 구현 및 검증 완료

상태: **6개 유형 구현·검증 완료**. 사용자 요청에 따라 이슈 #11의 계획을 REV-JAVA-01부터 순서대로 구현했습니다. 아래 코드·결과 발췌는 수정 전 검수 근거이며, 수정 후 위치별 결과와 전체/증분 검증은 [완료 보고서](../audits/legacy-bank-java8-issue11-completion/README.md)를 참고합니다.

기존 추적 이슈 #11은 사용자 요청으로 2026-11-05 삭제했습니다. 구현·완료 기준은 이 문서에 보존하며, [새 빌드 재분석 검증](../audits/legacy-bank-java8-rebuild-20261105/README.md)도 통과했습니다.

기준은 `legacy-bank-java8`의 `20261104-164240` 분석, 분석기 커밋 `6ffaab8c23bd7f88abbeda4654580acccf697043`입니다. 원본 84개 파일과 분석 입력의 SHA-1이 일치합니다. 원본 프로젝트는 별도 분석 입력이며, 아래 `src/...`는 그 프로젝트 기준 경로입니다. 실제 분석 결과의 필요한 필드만 발췌했습니다.

기존 구현은 [PR #9](https://github.com/zerotosetta/leflect-java/pull/9)로 반영됐습니다. 이 계획은 이후 원본 전수 대조에서 찾은 6개 유형을 대상으로 합니다. [검수 보고서](../audits/legacy-bank-java8-20261104/README.md), [유형별 전체 위치·실제 결과](../audits/legacy-bank-java8-20261104/findings.json), [파일별 검수 범위](../audits/legacy-bank-java8-20261104/coverage.json)를 함께 봅니다.

| 키 | 대상 | 기준 발생 범위 | 상태 |
| --- | --- | --- | --- |
| [REV-JAVA-01](#rev-java-01) | 정적 상수·enum 소유 타입 의존성 | 사용 6곳 / 파일·타입 쌍 5개 / 타입 4종 | 완료 |
| [REV-JAVA-02](#rev-java-02) | synchronized 실행 순서 | 블록 4개 / 내부 호출 24곳 | 완료 |
| [REV-JAVA-03](#rev-java-03) | 명시적 생성자 호출의 메서드 요약 | super 호출 1곳 | 완료 |
| [REV-JAVA-04](#rev-java-04) | this 필드 쓰기 분류 | 대입 6곳 | 완료 |
| [REV-JSP-01](#rev-jsp-01) | 표준 EL 함수 수집·해석 상태 | fn 함수 40곳 | 완료 |
| [REV-REPORT-01](#rev-report-01) | EL 함수의 영향·사용 조회 | 사용자 함수 4곳 | 완료 |

단위가 다른 건수는 합산하지 않습니다. REV-JAVA-02·03은 원시 호출 그래프가 정확하지만 메서드 요약에서 빠진 사례입니다. REV-JSP-01은 EL AST 손실이 아닌 이번 설정의 TLD 수집 범위와 조용한 제외 처리 문제입니다.

## REV-JAVA-01

**문제: 정적 상수·enum 소유 타입 의존성 누락**

원본 `src/main/java/demo/bank/BTConnector.java:29`:

```java
int offset=now.getDayOfWeek()==DayOfWeek.SUNDAY?8:now.getDayOfWeek()==DayOfWeek.SATURDAY?6:4;
```

독립 `javac --release 8` 대조 결과의 해당 위치:

```json
{
  "file": "src/main/java/demo/bank/BTConnector.java",
  "line": 29,
  "column": 56,
  "target": "java.time.DayOfWeek",
  "name": "DayOfWeek",
  "rawRecorded": false,
  "dependencyRecorded": false
}
```

| 원본 위치 | 코드 | 빠진 타입 |
| --- | --- | --- |
| BTConnector.java:29:56, 29:95 | DayOfWeek.SUNDAY / SATURDAY | java.time.DayOfWeek |
| QueryEngine.java:23:50 | Locale.ROOT | java.util.Locale |
| Web.java:17:82 | Locale.KOREA | java.util.Locale |
| services/DirectProductService.java:17:173 | RoundingMode.DOWN | java.math.RoundingMode |
| tags/QuoteTag.java:21:54 | PageContext.PAGE_SCOPE | javax.servlet.jsp.PageContext |

**처리 제안**

정적 필드·enum 상수의 한정자를 실제 심볼 해석으로 타입 사용으로 식별하고 소유 타입 FQN·파일·전체 범위를 저장합니다. 대문자 이름만으로 타입을 추측하지 않습니다. 사용 위치는 보존하고 기존 파일 그래프의 집약 규칙으로 연결합니다.

**완료 기준**

- [x] 위 6곳의 정확한 타입·시작/종료 행·열이 원시 참조에 기록됩니다. DayOfWeek의 두 위치를 서로 구분합니다.
- [x] 파일·타입 5쌍에서 기대한 외부 타입으로 이동하며, 같은 관계가 다른 근거로 이미 있다면 중복 집계하지 않습니다.
- [x] 대문자 지역 변수, 동명 클래스, 패키지 경로 조각을 타입으로 오인하지 않습니다. 해석 실패에는 상태·근거를 남깁니다.
- [x] 기존 선언 타입 사용 위치 799곳, new 121곳, import 154곳과 호출 대상을 보존합니다. 전체 원시 참조 수를 954+6으로 고정하지 않고 추가된 참조 각각의 원본 근거를 검증합니다.

**사용자 제안 / 검토 의견** —

## REV-JAVA-02

**문제: synchronized 본문이 orderedSteps에서 누락**

원본 `src/main/java/demo/bank/TransferDraft.java:28–34`:

```java
synchronized(session) {
    TransferDraft draft=(TransferDraft)session.getAttribute("TRANSFER_DRAFT");
    if(draft==null || !draft.id.equals(request.getParameter("requestId")))
        throw new BankException(409,"DUPLICATE","이미 처리되었거나 만료된 이체 요청입니다.");
    session.removeAttribute("TRANSFER_DRAFT");
    return draft;
}
```

같은 `consume` 메서드의 실제 `orderedSteps` 발췌. 전체 3개 단계가 27행에서 끝납니다.

```json
[
  { "kind": "call", "snippet": "Web.requirePost(request)", "lineRange": { "startLine": 26 } },
  { "kind": "call", "snippet": "request.getSession()", "lineRange": { "startLine": 27 } },
  { "kind": "assignment", "snippet": "session = request.getSession()", "lineRange": { "startLine": 27 } }
]
```

| 메서드 | 본문에서 빠진 호출 위치 |
| --- | ---: |
| Operations.issue | 9 |
| Operations.consume | 5 |
| TransferDraft.consume | 4 |
| Web.csrf | 6 |

위 호출 24곳은 원시 호출 인덱스와 그래프에는 존재합니다. 실행 요약에서는 호출뿐 아니라 본문의 조건·대입·throw·return도 빠집니다.

**처리 제안**

실행 순서 추출기에 synchronized 처리 경로를 추가합니다. 잠금 표현식을 먼저 평가하고 본문을 순서대로 방문하며 잠금 범위와 내부 분기 맥락을 보존합니다. 호출 그래프 생성과 메서드 실행 요약의 중복 계산을 방지합니다.

**완료 기준**

- [x] 실제 4개 블록의 호출 24곳과 조건·대입·객체 생성·throw·return이 원본 위치와 실행 순서에 맞게 나타납니다.
- [x] 잠금 표현식에 호출이 있는 입력도 본문 전에 한 번 평가합니다. 중첩 synchronized·if·루프의 branchPath/소유 범위가 보존됩니다.
- [x] 메서드 밖의 코드나 다른 메서드 본문을 섞지 않고, 정상/예외 종료 뒤 단계를 무조건 실행하는 것으로 표현하지 않습니다.
- [x] 기존 원시 호출 646곳과 타깃을 보존하며 중복 호출을 추가하지 않습니다. 수정 전후 메서드별 실행 요약과 호출 인덱스를 위치로 대조합니다.

**사용자 제안 / 검토 의견** —

## REV-JAVA-03

**문제: super 호출이 callTargets·orderedSteps에 반영되지 않음**

원본 `src/main/java/demo/bank/BankException.java:7`:

```java
super(message); this.status = status; this.code = code;
```

실제 호출 그래프 발췌:

```json
{
  "type": "JAVA_CONSTRUCTOR_CALL",
  "fromSymbol": "demo.bank.BankException#BankException(int,String,String)",
  "toSymbol": "java.lang.RuntimeException#<init>(java.lang.String)",
  "fromLocation": { "line": 7, "column": 9, "endLine": 7, "endColumn": 22 }
}
```

같은 생성자의 실제 메서드 요약 발췌:

```json
{
  "callTargets": [],
  "orderedSteps": [
    { "kind": "assignment", "snippet": "this.status = status" },
    { "kind": "assignment", "snippet": "this.code = code" }
  ]
}
```

**처리 제안**

명시적 생성자 위임의 해석 결과를 호출 인덱스·그래프·메서드 callTargets·orderedSteps에서 공유합니다. constructor 이름/시그니처 표기는 기존 그래프의 `<init>` 규칙을 따릅니다.

**완료 기준**

- [x] 7행 9–22열의 호출이 `RuntimeException#<init>(java.lang.String)`으로 메서드 callTargets와 orderedSteps에도 기록됩니다.
- [x] 해당 호출이 뒤의 두 필드 대입보다 앞에 한 번만 나타나며, 호출한 BankException 생성자 ID와 원본 범위를 유지합니다.
- [x] 명시적 this(...)·super(...)의 오버로드, 외부/내부 생성자, 해석 실패를 검증합니다. 실패를 임의의 생성자에 연결하지 않습니다.
- [x] 기존 메서드 호출 645곳·명시적 super 1곳·new 121곳을 구분해 보존합니다. 암시적 super()는 기존대로 후속 범위입니다.

**사용자 제안 / 검토 의견** —

## REV-JAVA-04

**문제: 동명 매개변수가 있으면 this 필드 쓰기를 일반 대입으로 분류**

원본 `src/main/java/demo/bank/BankException.java:7`:

```java
this.status = status; this.code = code;
```

실제 실행 요약 발췌:

```json
{ "kind": "assignment", "snippet": "this.status = status" }
```

| 원본 위치 | 실제 코드 | 현재 → 기대 분류 |
| --- | --- | --- |
| BankException.java:7:25 | this.status = status | assignment → field-write |
| BankException.java:7:47 | this.code = code | assignment → field-write |
| BTConnector.java:10:32 | this.code=code | assignment → field-write |
| TransferDraft.java:15:108 | this.from=from | assignment → field-write |
| TransferDraft.java:15:124 | this.to=to | assignment → field-write |
| TransferDraft.java:15:136 | this.amount=amount | assignment → field-write |

같은 생성자의 `this.id=UUID.randomUUID().toString()`은 이미 field-write입니다. 동명 매개변수가 있는지에 따라 명시적 this 접근의 분류가 달라집니다.

**처리 제안**

대입 대상의 AST/해석 심볼에서 명시적 this 필드를 먼저 판정하고 소유 타입·필드 정보를 유지합니다. 비한정 이름의 지역 변수/매개변수 가림은 Java의 이름 해석 규칙을 따릅니다.

**완료 기준**

- [x] 위 6곳을 field-write로 분류하고 필드 소유 타입·이름·원본 범위를 확인할 수 있습니다.
- [x] `this.f = f`의 왼쪽 필드와 오른쪽 매개변수를 구분합니다. 동명 지역 변수의 `f = value`는 지역 대입으로 유지합니다.
- [x] 기존 this.id field-write와 선언 필드 37개를 보존하며 상속 필드·동명 가림의 오분류를 회귀 검증합니다.
- [x] `page.help = ...` 같은 다른 객체의 대입 5곳은 이번 6곳과 별도로 집계합니다. 그 범위 확장은 사용자 제안에서 결정합니다.

**사용자 제안 / 검토 의견** —

## REV-JSP-01

**문제: 표준 함수 의존성과 수집 제외 상태가 빠짐**

원본 `src/main/webapp/WEB-INF/jsp/bank/accounts.jsp:19`의 표현식:

```jsp
${fn:length(accounts)}
```

현재 분석과 독립 대조 결과의 해당 위치:

```json
{
  "file": "src/main/webapp/WEB-INF/jsp/bank/accounts.jsp",
  "prefix": "fn", "name": "length",
  "location": { "line": 19, "column": 27 },
  "source": "${fn:length(accounts)}",
  "metadataMatches": 0
}
```

EL AST에는 함수 구문이 있으나 functionCalls·JSP_FUNCTION_CALL·실패/제외 진단에는 기록되지 않습니다. 대상은 escapeXml 30곳, length 8곳, split 2곳으로 총 40곳입니다.

이번 설정은 `jsp.tld.autoLoad`를 켜지 않았고, 구현은 TLD가 없는 표준 함수 URI를 조용히 건너뜁니다. classpath의 `taglibs-standard-impl-1.2.5.jar!/META-INF/fn.tld`와 실제 public static 메서드는 존재합니다.

```text
org.apache.taglibs.standard.functions.Functions
java.lang.String escapeXml(java.lang.String)
int length(java.lang.Object)
java.lang.String[] split(java.lang.String, java.lang.String)
```

수정 전 검수의 메모리 비교에서는 autoLoad:true로 40/40곳이 실제 classpath 대상으로 해석됐습니다. 이후 이번 구현에서 실제 활성/제외 설정의 재분석까지 수행했으며 결과는 완료 보고서에 기록했습니다.

**처리 제안**

우선 해당 분석 설정/재현 프리셋에 classpath TLD 수집을 명시해 40곳을 해석합니다. 의도적으로 라이브러리 분석을 끄는 설정에는 사용 위치별 제외 사유와 수집 범위를 남기도록 구현을 보완합니다. 전역 기본값 변경 여부는 검토 의견으로 확정합니다.

**완료 기준**

- [x] 실제 40곳을 URI·함수명·선언 위치·클래스·메서드·인자/반환 타입·원본 위치로 연결합니다. 사용자 함수 4곳을 보존해 총 44곳을 구분합니다.
- [x] 실제 분석 classpath에서 public static/오버로드/시그니처를 검증합니다. TLD나 바이너리 누락·잘못된 시그니처에는 구체적인 해석 상태를 남깁니다.
- [x] 수집을 끈 경우에도 40개 사용 위치와 제외 사유를 확인할 수 있어야 합니다. 미해결 0건만으로 전체 함수 수집이 완료됐다고 판정하지 않습니다.
- [x] classpath의 로컬 TLD만 사용하고 함수/태그를 실행하지 않습니다. EL 286곳의 AST·원문·범위를 보존합니다.
- [x] c/fmt 태그 178곳의 Java 핸들러 연결은 기존 범위 메모로 유지합니다. 이번 fn 함수 40곳과 한 항목으로 자동 확대하지 않습니다.

**사용자 제안 / 검토 의견** —

## REV-REPORT-01

**문제: EL 함수의 그래프 연결이 영향 요약·Java 사용 조회에서 빠짐**

원본 `src/main/webapp/WEB-INF/jsp/bank/login.jsp:5`:

```jsp
<wfw:field name="PASSWORD_HASH" value="${bank:sha256(param.password)}"/>
```

실제 그래프에는 다음 연결이 있습니다.

```json
{
  "type": "JSP_FUNCTION_CALL",
  "fromFile": "src/main/webapp/WEB-INF/jsp/bank/login.jsp",
  "toFile": "src/main/java/demo/bank/Web.java",
  "toSymbol": "demo.bank.Web#sha256(java.lang.String)",
  "fromLocation": { "line": 5, "column": 50, "endLine": 5, "endColumn": 60 }
}
```

같은 JSP의 `query jsp-impact` 결과는 `javaTargets: []`입니다. `query java-usages --class demo.bank.Web`도 `jspCallers: []`입니다.

| 원본 위치 | 함수 | 정확한 실제 대상 |
| --- | --- | --- |
| login.jsp:5 | bank:sha256 | Web.sha256(String) |
| ledger.jsp:69 | bank:entryLabel | Web.entryLabel(Object) |
| csrf.tag:3 | bank:csrfToken | Web.csrf(HttpServletRequest) |
| status.tag:7 | bank:statusLabel | Web.statusLabel(Object) |

함수만 사용하는 csrf.tag·status.tag 두 파일은 영향 요약 목록에서도 빠집니다. 보고서 필터가 JSP_SCRIPTLET_CALL만 선택하고 JSP_FUNCTION_CALL을 포함하지 않는 것이 원인입니다.

**처리 제안**

JSP 함수 연결을 Java 영향 대상과 호출자 조회에 반영합니다. 원시 연결을 재생성하지 않고 기존 관계를 요약에 투영해 사용 위치와 고유 대상 수를 구분합니다.

**완료 기준**

- [x] 위 4개 파일의 JSP 영향 요약에 Web 대상과 실제 함수·시그니처·원본 위치를 확인할 수 있습니다.
- [x] Web의 jspCallers가 login.jsp·ledger.jsp·csrf.tag·status.tag 네 파일을 각 1회 포함합니다. 함수만 사용하는 두 .tag 파일도 영향 목록에 나타납니다.
- [x] REV-JSP-01로 추가되는 표준 함수는 외부 Java 대상으로 분류하고, 사용자 Web 대상이나 태그 핸들러와 섞어 연결하지 않습니다.
- [x] 기존 원시 함수 연결 4개, 태그 핸들러 59곳, 파일 참조 46곳을 보존합니다. 보고서 수정을 이유로 원시 그래프에 중복 연결을 만들지 않습니다.
- [x] summary.json·impact.md·jsp-impact·java-usages·관련 상세 결과가 같은 관계를 표현하는지 확인합니다. 미해결 함수는 성공 호출자 목록에 섞지 않습니다.

**사용자 제안 / 검토 의견** —

## 적용 순서와 공통 완료 기준

1. REV-JAVA-01로 타입 참조, REV-JAVA-02·03·04로 실행·메서드 요약을 보완합니다. 같은 추출기를 수정하는 항목은 함께 회귀 검증합니다.
2. REV-JSP-01의 설정과 제외 상태 정책을 확정하고 표준 함수 40곳을 수집합니다.
3. REV-REPORT-01로 수집된 함수 관계를 보고서·조회에 반영합니다.
4. 같은 원본의 전체 분석과 증분 분석을 수행하고 위치별 완료 기준을 판정합니다.

공통 검증:

- [x] 각 키에 성공·실패·제외 상태, 원본 경로·행·열, 실제 대상 또는 분류와 검증 근거를 남깁니다.
- [x] 기존 117건, 타입 43개·메서드/명시적 생성자 108개·필드 37개, 호출 646곳(645+super 1), new 121곳·import 154곳을 보존합니다.
- [x] JSP 페이지 21개와 조각/태그 파일 6개를 구분합니다. 시작 태그 861개·속성 987개·EL 286곳(페이지 269+조각 17)·주석 4개·지시문 45개를 원본 위치로 대조합니다.
- [x] 기존 사용자 함수 4곳·태그 파일 참조 42곳·고정 액션 include 4곳·지시문 include 17곳, HTTP 2개, TASK 사용 22곳/고유 코드 17개를 보존합니다.
- [x] 원본 변경·삭제 후 전체/증분 분석의 인덱스·의미 AST·그래프·역색인·보고서가 일치합니다. 바뀌지 않은 실행의 캐시도 확인합니다.
- [x] 정상 입력과 모호한 타입·불완전 입력·누락 라이브러리의 진단을 함께 검증합니다. 그래프 전체 개수를 기존 1,206개에 고정하지 않고 각 추가 관계의 원본 근거·중복 여부로 판정합니다.
- [x] 관련 회귀 테스트, pnpm release:check와 Java worker 테스트를 통과하고, 완료/미완료/보류를 항목별로 기록합니다.

**공통 사용자 제안 / 적용 순서 변경 의견** —

## 보류 및 범위 유지

| 키/범위 | 상태 |
| --- | --- |
| AUD-ENTRY-03 | 보류: CMS 데이터가 선택하는 실제 forward 대상 |
| AUD-DB-01 | 보류: SQL 정의 33개와 쿼리·파라미터·테이블 연결 |
| AUD-DB-02 | 보류: 메타데이터가 선택하는 리플렉션 실제 대상 |
| 암시적 super(), 애너테이션 7곳, 다른 객체 필드 대입 5곳 | 후속 범위 또는 검토 의견으로 확정 |
| JSTL c/fmt 178곳의 핸들러 연결, useBean 타입의 그래프 연결, JNDI Resource 17개의 설정 관계 | 현재 지원 범위 메모 유지 |

계획 문서만 등록했던 시점에는 구현 전이었으며, 이번에 6개 항목의 구현과 위치별 검증을 완료했습니다. 보류 항목은 위 표의 상태를 유지합니다.
