# 이슈 #11 구현·검증 결과

당시 이슈 #11로 추적한 6개 유형을 REV-JAVA-01부터 순서대로 구현하고 `legacy-bank-java8`을 재분석했습니다. 아래 완료 판정은 기존 원본의 위치별 검사, 부정 입력 회귀 테스트, 전체/증분 비교를 함께 사용했습니다. 이슈는 사용자 요청으로 2026-11-05 삭제했으며, [새 빌드 재분석 검증](../legacy-bank-java8-rebuild-20261105/README.md)도 통과했습니다.

- 수정 전 기준: `20261104-164240`, 분석기 `6ffaab8`
- 수정 후 분석기 소스 기준: `7140295`
- 함수 수집 활성 분석: `issue11-20261104-182000` (`jsp.tld.autoLoad: true`)
- 수집 제외 비교 분석: `issue11-20261104-182000-excluded` (`autoLoad: false`)
- 원본 84개 SHA-1 일치. Java 42개, JSP 페이지 21개, 태그/조각 6개

## 유형별 완료 판정

| 키 | 결과 | 위치별 근거 |
| --- | --- | --- |
| REV-JAVA-01 | 완료 | 누락된 정적 타입 사용 6곳·파일/타입 5쌍 연결. 원시 참조는 966곳이며 추가된 static-qualifier 12곳도 모두 원본 근거 확인. 상속된 `Child.VALUE`는 실제로 작성한 Child 타입에 연결 |
| REV-JAVA-02 | 완료 | synchronized 4개 범위의 호출 24곳과 조건·대입·생성·throw·return 보존. 잠금 평가 후 본문을 배치하고 중첩/정상 완료 조건을 branchPath에 기록 |
| REV-JAVA-03 | 완료 | BankException.java:7:9–22의 super(String)를 메서드 callTargets·constructor-call 단계에도 한 번 기록하고 뒤의 대입보다 앞에 배치 |
| REV-JAVA-04 | 완료 | 명시적 this 필드 쓰기 6곳이 field-write이며 field.id/classId/name으로 소유 필드 확인. 지역/매개변수 대입·상속/가림 회귀 검증 |
| REV-JSP-01 | 완료 | 표준 함수 40곳+사용자 함수 4곳의 선언·정확한 시그니처·사용 위치·그래프 일치. 수집을 끈 분석에서는 40곳 모두 excluded·이유·정보 진단을 유지하며 성공/실패 그래프를 생성하지 않음 |
| REV-REPORT-01 | 완료 | Web의 사용자 함수 호출 파일 4개와 함수 전용 .tag 2개의 영향 요약 반영. 표준 함수는 외부 Java 대상으로 구분. 함수 사용 14개 파일의 사용 수 합계 44곳이 실제 위치 집합과 일치 |

`synchronized`와 `normal-completion` 경로는 분기 조건을 보존한 소스 순서 요약입니다. 완전한 메서드 간 CFG나 실행 중 잠금 상태를 추론했다고 해석하지 않습니다.

## 실제 결과 예시

BankException의 생성자 요약:

```json
{
  "callTargets": ["java.lang.RuntimeException#<init>(java.lang.String)"],
  "orderedSteps": [
    { "kind": "constructor-call", "snippet": "super(message)" },
    { "kind": "field-write", "field": { "id": "demo.bank.BankException#status", "classId": "demo.bank.BankException", "name": "status" } },
    { "kind": "field-write", "field": { "id": "demo.bank.BankException#code", "classId": "demo.bank.BankException", "name": "code" } }
  ]
}
```

표준 함수 수집을 끈 분석에서도 `${fn:length(accounts)}` 같은 각 사용 위치는 `validation: "excluded"`와 `excludedReason`을 가지며 `logs/jsp-function-diagnostics.json`에 정보 진단이 남습니다. 수집을 켜면 실제 classpath의 public static 메서드로 해석됩니다. 명시적 수집을 요청했는데 TLD/바이너리가 없거나 시그니처가 틀리면 unresolved와 구체적 이유가 남습니다.

## 공통 회귀·증분 검사

| 검사 | 결과 |
| --- | --- |
| 독립 javac --release 8 대조 | 오류 0건, 선언·호출·원본 범위 일치 |
| 6개 유형 + 공통 위치 검사 | 38개 검사 통과 |
| 기존 기준 | 117/117건, 의미 분석 314개 검사 통과 |
| Java | 타입 43·메서드/명시적 생성자 108·필드 37, 호출 646곳(645+super 1), new 121곳, import 154곳 보존 |
| JSP 원본 전수 대조 | 시작 태그 861·속성 987·EL 286(페이지 269+조각 17)·주석 4·지시문 45 일치 |
| 기존 연결 | 사용자 태그 핸들러 59곳·태그 파일 42곳·고정 액션 include 4곳·지시문 include 17곳 보존 |
| 진입점·TASK | HTTP 2개, TASK 사용 22곳/고유 코드 17개 보존 |
| 활성/제외 분석의 무변경 증분 | 각각 산출물 144개/143개 일치, 차이 0개 |
| 변경·삭제 후 전체/증분 | 산출물 142개 일치, 차이 0개. 시그니처·생성자·필드·동기화 본문·함수·TASK·경로 변경 및 Java 삭제의 의미 검사 10개 모두 통과 |
| pnpm release:check | TypeScript·프런트엔드 검사, 테스트 114개, 프로덕션 빌드 통과 |
| Java worker | 테스트 18개, 실패·오류 0개, package 성공 |

활성 분석의 원시 파일 그래프는 1,252개입니다. 표준 함수 40곳 및 근거 있는 타입 참조가 추가됐으므로 수정 전 그래프 수 1,206개와의 단순 수량 일치를 완료 기준으로 사용하지 않았습니다. 표준 c/fmt 태그 178곳의 외부 핸들러 그래프는 이번 범위에 추가하지 않았습니다.

## 보류·지원 범위

CMS 실제 forward 대상(AUD-ENTRY-03), SQL 정의/쿼리·파라미터·테이블 연결(AUD-DB-01), 메타데이터 기반 리플렉션 실제 대상(AUD-DB-02)은 **보류**입니다. 암시적 super(), 애너테이션 의존성, 다른 객체 필드 대입, 표준 태그 핸들러·useBean 타입·JNDI 설정 관계도 계획서의 범위 메모를 유지합니다.

원본 애플리케이션이나 DB를 실행하지 않았으며 브라우저 시각 검사는 포함하지 않습니다. 외부 소스 문서의 제공 여부는 타입 해석과 별도 상태입니다. 제공된 JDK8 검증 archive에 소스가 없는 타입도 실제 타입 연결을 유지합니다.

## 근거

- [계획서와 완료 기준](../../plans/2026-11-04-analysis-accuracy-revision-plan.md)
- [검증 집계·공통/증분 결과·테스트 근거](verification.json)
- [6개 유형의 원본 위치별 실제 결과](evidence.json)
- [경로를 치환한 분석 환경](environment.json)
- [수정 전 전수 검수](../legacy-bank-java8-20261104/README.md)

전체 원시 결과는 로컬 `analysis/legacy-bank-java8/issue11-20261104-182000`과 `-excluded` 폴더에 있습니다. 공개 자료의 개인 PC 경로는 자리표시자로 치환했습니다.
