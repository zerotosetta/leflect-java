# legacy-bank-java8 재분석·원본 전수 검수

분석 실행은 `20261104-164240`, 분석기 커밋은 `6ffaab8c23bd7f88abbeda4654580acccf697043`입니다. [PR #9](https://github.com/zerotosetta/leflect-java/pull/9)의 구현을 반영한 뒤 같은 원본을 새 폴더에서 전체·증분 분석하고, 원본에서 항목을 먼저 열거해 출력과 양방향 대조했습니다.

**추가 문제 6유형이 남아 있습니다.** 아래 결과와 [수정 계획서 초안](../../plans/2026-11-04-analysis-accuracy-revision-plan.md)은 구현 완료 보고가 아닙니다.

원본은 별도의 `legacy-bank-java8` 프로젝트입니다. `src/...`는 원본 프로젝트 기준 경로입니다. 개인 PC의 절대 경로는 `<SOURCE_ROOT>`, `<WORKSPACE>`, `<MAVEN_REPOSITORY>`로 바꿨습니다. 이 문서에는 검수 범위와 유형별 근거를 수록했습니다.

## 재분석 결과

| 항목 | 기록된 결과 |
| --- | --- |
| 원본 입력 | 84개 파일 SHA-1 일치, 해시 차이 0개 |
| 대상 | Java 42개, JSP 페이지 21개, 태그 파일 5개, JSP 조각 1개 |
| Java 선언 | 타입 43개, 메서드/명시적 생성자 108개, 필드 37개 |
| 파싱 오류 | Java 0건, JSP 0건 |
| 기존 117건 기준 | 117/117 통과 |
| 호출·생성·import 회귀 | 기존 호출 645곳, new 121곳, import 154곳의 대상·위치 일치 |
| 의미 분석 회귀 | 314개 검사 통과 |
| 전체/변경 없는 증분 실행 | 산출물 144개 일치 |
| worker 테스트 | 13개 통과, 실패·오류 0개 |

위 회귀 검사는 기존 완료 기준에 대한 결과입니다. 이번에 추가로 확인한 6개 문제는 아래 전수 검수에서 분리해 기록했습니다. `unresolvedEdges: 0`은 이미 생성된 그래프 연결의 해석 상태이며, 처음부터 수집하지 않은 관계나 요약의 누락 여부를 보장하지 않습니다.

## 전수 대조 범위

| 범위 | 확인 결과 |
| --- | --- |
| Java 42개 | 별도 javac --release 8 해석, 컴파일러 오류 0건. 타입 43개·메서드 108개·필드 37개의 선언과 원본 범위 일치 |
| 명시적 Java 호출 | 메서드 645곳 + super 1곳 = 646곳의 호출자·대상·범위 일치. 추가 호출 오탐 0곳 |
| Java 참조 | 선언 타입 구문 고유 위치 799곳 대응. 원시 참조 954개 모두 원본 근거 있음. 정적 타입 한정자 추가 검사에서 6곳의 의존성 누락 발견 |
| JSP 계열 27개 | 독립 문자 스캐너로 시작 태그 861개·속성 987개·EL 286곳·주석 4개·지시문 45개·실행 스크립틀릿 0곳 대조. 원시/의미 AST의 원문·범위·소유 관계 불일치 0건 |
| TLD 2개 | 태그/태그 파일 선언 11개·Java 태그 속성 17개·사용자 함수 선언 4개 일치 |
| 그래프 | 1,206개 연결의 원본/인덱스 근거 확인. 중복 행·사라진 대상 파일·근거 없는 연결 0건 |
| 순·역참조 | 프로젝트 파일 노드 69개, 순방향 참조 541쌍·내부 역참조 205쌍, 심볼 역색인 6종 일치 |
| 화면용 데이터 | 프로젝트 69개+외부 심볼 74개=시작점 143개에서 도달 노드 집합 일치. 브라우저 시각 검사는 포함하지 않음 |
| 외부 심볼 | 74종의 binary/provider 대조. 제공된 소스 16종 일치, 나머지 58종은 archive 내 해당 소스가 없는 not-found 상태 |
| HTTP·TASK | 진입점 2개·등록 서블릿 분류 2개·TASK 사용 22곳/고유 코드 17개 일치 |
| 동적 include | 2곳의 근거 41개, 값/JDBC 자원 역할과 소스 범위 확인. 실제 경로는 동적 상태 유지 |

EL 286곳은 원래 JSP 페이지 269곳+태그/조각 17곳입니다. 그래프의 new 70개와 원시 사용 위치 121곳은 집계 단위가 다릅니다.

## 추가 발견

| 키 | 유형 | 실제 코드와 현재 분석 결과 |
| --- | --- | --- |
| REV-JAVA-01 | 정적 상수·enum 타입 의존성 누락 | `DayOfWeek.SUNDAY/SATURDAY`, `Locale.ROOT/KOREA`, `RoundingMode.DOWN`, `PageContext.PAGE_SCOPE` 6곳. 원시 타입 참조·해당 파일의 타입 의존성 없음. 파일/타입 5쌍, 타입 4종 |
| REV-JAVA-02 | synchronized 실행 요약 누락 | Operations.issue 9·consume 5, TransferDraft.consume 4, Web.csrf 6호출. 원시 호출은 정확하며 orderedSteps에서 4개 블록 본문이 빠짐 |
| REV-JAVA-03 | 생성자 호출 요약 불일치 | BankException.java:7의 `super(message)`는 RuntimeException(String)으로 그래프 연결됨. 메서드 callTargets=[]이고 orderedSteps에는 뒤 대입 2개만 기록 |
| REV-JAVA-04 | this 필드 쓰기 분류 오류 | `this.status=status` 등 6곳이 assignment. 동명 매개변수가 없는 this.id는 field-write여서 명시적 필드의 분류가 일관되지 않음 |
| REV-JSP-01 | 이번 설정의 표준 함수 수집·해석 상태 누락 | fn:escapeXml 30·length 8·split 2=40곳. EL AST는 보존되나 functionCalls·그래프·제외 진단 없음. 메모리 autoLoad:true 비교에서는 40곳 모두 실제 classpath 시그니처로 해석 |
| REV-REPORT-01 | 함수 영향·사용 조회 누락 | login.jsp:5·ledger.jsp:69·csrf.tag:3·status.tag:7의 사용자 함수 4곳이 Web으로 정확히 연결됨. JSP 영향 javaTargets 및 Web의 jspCallers에는 누락. 함수 전용 .tag 2개도 영향 요약에서 제외 |

실제 코드, 분석 결과 발췌, 처리 제안, 검토란, 완료 기준은 [계획서](../../plans/2026-11-04-analysis-accuracy-revision-plan.md)에 있습니다. [findings.json](findings.json)에는 각 발견의 모든 사용 위치·원문·대상·현재 상태와 표준 함수 메모리 비교 결과를 담았습니다.

## 보류·지원 범위

- CMS 데이터가 선택하는 실제 forward 대상(AUD-ENTRY-03), SQL 정의 33개와 쿼리/파라미터/테이블 연결(AUD-DB-01), 메타데이터 기반 리플렉션 실제 대상(AUD-DB-02)은 기존 보류 상태입니다.
- 암시적 super(), 애너테이션 7곳, 다른 객체 필드 대입 5곳, JSTL c/fmt 178곳의 Java 핸들러 연결, useBean 타입의 별도 그래프 연결, JNDI Resource 17개/고유 클래스 13개의 설정 관계는 이번 6개 수정의 자동 확장 범위가 아닙니다.
- 정적 소스·분석 결과 대조이며 실행 중인 DB·요청·세션 값의 동작 검증은 포함하지 않습니다.

## 저장된 근거

- [findings.json](findings.json): 6개 유형의 전체 발생 위치와 실제 코드·분석 결과, 표준 함수 40곳의 해석 비교
- [coverage.json](coverage.json): 원본 84개 해시, Java 42개·JSP 27개 파일별 검수 수량과 범위, 그래프·동적 참조·보류 상태
- [verification-summary.json](verification-summary.json): 이번 전체/증분 재분석과 기존 회귀 기준의 검증 결과

개별 AST·전체 원시 분석 출력은 로컬의 원래 `analysis/legacy-bank-java8/20261104-164240` 결과에 남아 있습니다. 공개 근거는 위 세 JSON과 실제 사례 발췌로 추적할 수 있습니다.
