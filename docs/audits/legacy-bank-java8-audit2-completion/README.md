# legacy-bank-java8 후속 수정 완료 보고서

사용자가 요청한 계획의 7개 항목과 프로젝트 의존성 우선 API 팩 연동을 구현하고 실제 원본으로 검증했습니다. 버전은 **0.1.8**을 유지합니다. npm 게시·배포 태그·새 이슈 생성은 하지 않았습니다. CMS·쿼리·리플렉션의 실제 대상 연결은 보류 상태입니다.

기준 계획은 [원본 전수 대조 후속 수정 계획](../../plans/2026-11-05-source-audit-revision-plan.md)이며, 구현 커밋은 `bb5b42e` → `2ac6e7f` → `11100ec` → `07a393e` → `9a16ace` → `f203b43`입니다. 선언·가드·continue·증감은 같은 실행 모델을 공유하며, 아래에서 키별 완료 판정을 분리했습니다.

## 실제 입력과 분석 실행

- 원본 입력 **84개 해시 유지**, Java **42개**, JSP 계열 **27개**. JSP 계열은 페이지 21개와 조각·태그 파일을 포함합니다.
- 실제 Java를 `javac --release 8 -proc:none`으로 다시 컴파일해 클래스 **43개**, 모두 major version 52임을 확인했습니다.
- 최종 분석: `analysis/legacy-bank-java8/audit2-20261105-1853`.
- TLD 제외 설정: 같은 경로의 `-excluded`, API 팩 대체 경로: `-fallback`.
- 이전 classpath 그대로 재실행한 호환 검증: 같은 경로의 `-baseline-classpath`.
- 잘못된 루트로 시작했다가 실패한 `audit2-20261105-1845` 실행은 완료 판정에 사용하지 않았습니다.

주 분석에는 프로젝트가 선언한 Servlet 4.0.1/JSP 2.3.3 binary를 명시했습니다. fallback 실행에서는 명시 API binary 두 개를 제외하고 같은 좌표의 내장 팩을 선택했습니다. 두 실행은 실제 Java/JSP 대상과 그래프 관계가 일치했습니다. 별도로 이전 Tomcat classpath를 그대로 사용한 실행에서도 호출 646개의 대상·기존 반환형, 메서드 108개의 legacy `orderedSteps`가 **문자열과 구조까지 그대로** 보존됐습니다.

## 키별 완료 판정

| 키 | 판정 | 실제 검증 결과 |
| --- | --- | --- |
| AUD2-IMPORT-01 | 완료 | import 154개 중 wildcard 116개와 명시 38개의 원본 전체 위치·ID·표기 보존, HTTP 상세 API에도 동일하게 전달 |
| AUD2-IMPORT-02 | 완료 | 기존 참조 20곳과 호출 출처 14곳 재대조, 선언 self-ID 154개, FQN 직접 표기 5곳, 패키지 경계·제네릭 기저·출처 상태 검증 |
| REVIEW-TYPE-01 | 완료 | 78개 구체 결과 타입 모두 fresh javac 결과와 일치, 메서드 호출 645개의 선언 반환형도 독립 javac와 대조, 생성자 위임은 별도 분류 |
| REVIEW-DECL-01 | 완료 | 지역 선언 156개·초기화 없는 선언 12개, 선언과 초기화 쓰기·후속 대입·변수 범위·초기화/null 상태 구별 |
| REVIEW-EXEC-01 | 완료 | 실제 단락 우변 호출 68곳의 원본 가드·CFG 진입 경로, `QueryEngine`의 null 경로, eager 연산·삼항·합류·재대입 fixture 검증 |
| AUD2-EXEC-01 | 완료 | `Cms.load`의 continue 1곳이 소유 while 조건으로 이동하고 60–61행을 건너뜀. 다른 반복문·label·finally·이동 재지정 fixture 통과 |
| AUD2-EXEC-02 | 완료 | 원본 증감 4곳의 소유 심볼·연산자·전위/후위 결과·정확한 범위·쓰기 효과 확인, 수신자와 배열 인덱스의 중복 평가 방지 |

import 검증은 **2,919/2,919**, 타입 검증은 **2,063/2,063**, 실행 검증은 **3,677/3,677** 통과했습니다. 108개 메서드의 v2 모델은 정의한 소스 범위에서 모두 `complete`이며, 기존 지원 동작 1,149곳의 의미와 원본 범위를 legacy/v2 양쪽에서 보존했습니다.

호출 출처 14곳 중 직접 수신자 선언에 근거가 있는 11곳은 올바른 import로 연결했습니다. `request.getSession().…` 두 곳과 `getJspBody().invoke(…)` 한 곳은 `receiver-call`로 구분하고 임의의 import를 붙이지 않았습니다. 단순히 예전 기대 import를 채워 넣어 통과시키지 않았습니다. 명시·wildcard static import와 자기 메서드·상속 메서드도 별도 fixture로 검증했습니다.

## API 팩과 결과 전달

[API 팩 설정·출처 문서](../../api-packs.md)에 구성과 지원 범위를 설명했습니다. 기본값은 `off`이며 `fallback`을 선택하면 프로젝트 source/classpath·Maven 의존성을 우선합니다. Maven 분석 classpath에는 `provided`도 포함합니다. 정확한 좌표가 없거나 버전 범위·미해석 속성·다른 namespace인 경우 임의 버전을 선택하지 않습니다.

내장 팩은 `javax.servlet:javax.servlet-api:4.0.1`, `javax.servlet.jsp:javax.servlet.jsp-api:2.3.3`의 binary·동일 좌표 sources·POM·원문 라이선스와 고지문·SHA-256을 포함합니다. JAR 시그니처 해석과 격리된 클래스 로더를 사용해 worker 내부 Servlet/JSP API가 프로젝트 API를 덮지 않습니다. 실제 사용 API 심볼 **40개**에서 provider/version과 대응 소스를 확인했습니다. binary 해석과 소스/Javadoc 제공 상태는 별개입니다.

- Java/JSP 양 stage에서 주 분석은 `project` 두 개, 대체 실행은 `pack` 두 개, 진단 0건. API 비교 **27개** 통과.
- 실제 HTTP 상세 API로 Java 파일 42개·메서드 108개의 메타데이터·원본 소스·v2 보고서 일치를 **192개** 검사했습니다.
- scoped 패키지 13개와 standalone NPX tarball을 로컬 생성했습니다. NPX tarball을 오프라인·설치 스크립트 없이 설치한 뒤 원본 전체를 분석해, 패키지 안의 worker/API 팩 자동 탐색과 호출 646개의 동일한 결과를 확인했습니다. 패키징 검사 **16개** 통과.
- 플랫폼 실행파일은 빌드하지 않았습니다. binary 패키징의 asset 포함·복사 설정까지 검증했으며 실제 실행파일 실행을 검증한 것으로 표시하지 않습니다.

독립 검토에서 발견한 동명 예외 타입의 catch 오연결, 부모 POM 속성의 자식 override 무시, qualified `this`의 필드 상태 혼합도 회귀 테스트와 함께 수정했습니다. foreach·switch의 변수 범위, 익명 클래스 본문 분리, 중첩 finally, 평가 참조의 결정적 순서도 검증했습니다.

## 회귀 및 전체·증분 비교

- Java worker **39개**, TypeScript **147개**, `pnpm release:check`와 관련 lint 통과.
- 기존 **117/117**, 앞선 6개 유형 **38/38**, 의미 검증 **314개** 통과.
- 타입 43개·메서드 108개·필드 37개·호출 646곳·new 121곳·원시 참조 966곳 보존.
- JSP 27개에서 태그 861개·속성 987개·EL 286곳·주석 4개·지시문 45개 보존. Java 핸들러 59곳·태그 파일 42곳·함수 44곳, HTTP 경로 2개·TASK 22곳/17코드도 보존.
- 무변경 증분: 산출물 **144개**, 차이 0, 원본 84개 해시 일치.
- 복사본에서 Java/JSP/설정 변경과 Java 삭제 후 전체/증분: 산출물 **142개**, 차이 0, 의존 호출·생성자·필드·동기화·함수·TASK·경로 등 **10개** 검증 통과. 원본에서 변경·삭제하지 않았습니다.
- 이전 classpath 호환 검증 **152개**와 기존 회귀 묶음 통과.

그래프 미해결 수는 0입니다. 이는 모든 런타임 값을 증명했다는 뜻이 아닙니다. 결과 타입은 `resolved` 640개, 캡처/경계 타입 등 `partial` 5개, 명시 생성자 위임 `not-applicable` 1개입니다. 수정 대상 78곳은 모두 `resolved`입니다. 호출의 import 출처를 확정하지 못한 41개는 이유와 함께 별도 상태로 남기며, 호출 대상 미해결로 섞지 않습니다.

메서드 내부 소스 CFG와 기본 상태 분석을 제공합니다. 메서드 간/전체 heap 별칭 분석, 임의 값 계산, 자동 NPE 경고, 컨테이너·DB 실행 증명은 포함하지 않습니다. 암시적 resource close·super와 암시적 산술/배열/null/monitor 예외는 명시된 한계로 유지합니다. CMS·쿼리·리플렉션 실제 연결은 계속 보류합니다.

## 근거와 재현

- [import 주요 위치·출처](imports.json), [타입 78곳의 독립 기대/실제 값](types.json), [선언·가드·증감·continue](execution.json)
- [공통 회귀·API·전체/증분·패키징·빌드 근거](common.json)

이 저장소의 JSON은 주요 위치별 결과, 전체 검사 분포와 전체 보고서 SHA-256을 담습니다. 개인 경로는 `<SOURCE>`, `<WORKSPACE>`, `<RUN>` 등으로 치환했습니다. 모든 위치별 전체 결과는 로컬 최종 분석 폴더의 `verification/audit2-{imports,types,execution}.json`에 보존했습니다. 실제 분석 JSON을 수정해 검사에 맞추지 않았습니다.

```powershell
$projectRoot = '<원본 프로젝트 절대 경로>'
$analysisRun = 'analysis/legacy-bank-java8/audit2-20261105-1853'
$baselineRun = 'analysis/legacy-bank-java8/rebuild-20261105-103212'
node bin/leflect analyze --root $projectRoot --config "$analysisRun/config.json"
node scripts/audit2/run-execution-oracle.mjs --source $projectRoot --out $analysisRun
node scripts/verify-audit2-imports.mjs --source $projectRoot --out $analysisRun --baseline $baselineRun
node scripts/verify-audit2-types.mjs --source $projectRoot --out $analysisRun --baseline $baselineRun
node scripts/verify-audit2-execution.mjs --source $projectRoot --out $analysisRun --baseline $baselineRun
node scripts/verify-audit2-consumers.mjs $analysisRun
node scripts/audit2/verify-api-packs.cjs $analysisRun "$analysisRun-fallback"
```

타입 검증에는 `scripts/audit2/JavaAuditDetailed.java`를 JDK로 컴파일·실행해 얻은 fresh `verification/java-symbols/source.tsv`와 입력/출력 해시·성공 상태를 담은 `metadata.json`이 필요합니다. 해당 실행 명령과 클래스패스는 `common.json`의 oracle 근거에 보존했습니다. 이 소스 전용 검증 도구는 원본과 기준 분석을 함께 요구하며 일반 프로젝트의 보편적인 성공 건수로 사용하지 않습니다.
