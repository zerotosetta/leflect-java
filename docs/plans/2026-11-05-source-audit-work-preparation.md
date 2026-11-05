# 수정 작업 착수 준비

상태: **구현 작업 준비 · 제품 코드 미변경**. [7개 항목의 완성 초안](2026-11-05-source-audit-revision-plan.md)을 작업 단위로 나누고, 추가 요청 방향인 분석용 API 팩을 별도로 준비합니다. 버전은 0.1.8을 유지하고 npm 게시·배포 태그·새 이슈를 만들지 않습니다.

## 작업 기준 고정

- 원본: `legacy-bank-java8`의 입력 84개, Java 42개·JSP 계열 27개
- 기준 분석: `analysis/legacy-bank-java8/rebuild-20261105-103212`
- 보존 기준: 원시 호출 646곳·타입 참조 966곳과 기존 선언·JSP 구조·정확한 대상
- 로컬 준비 기록: `analysis/work-preparation/baseline.json`에 원본 84개와 분석 산출물 208개의 해시 저장
- 원본 소스와 기존 분석 산출물은 수정하지 않고 이후 재분석은 새 출력 디렉터리에서 비교

AUD2-IMPORT-01은 **import 위치를 전달할 때 선언 키가 달라지는 문제**입니다. API 소스나 JAR의 부재 때문에 발생한 것으로 분류하지 않습니다. 추가 API 팩은 별도의 편의·분석 환경 작업이며 기존 확정 보완 4개/계약 확인 3개 건수를 바꾸지 않습니다.

## 구현 작업 단위

| 순서 | 작업 키 | 범위·진입점 | 먼저 확보할 검증 |
| --- | --- | --- | --- |
| 1 | AUD2-IMPORT-01 | `packages/indexer/src/java-index.ts`의 import 선언 키·위치 대응 | wildcard 116곳의 전체 범위, 명시 38곳·전체 154개 ID/표기 보존 |
| 2 | AUD2-IMPORT-02 | 같은 파일의 import lookup·resolveImportId·호출 인덱스 | 타입 참조 20개와 호출 정보 14개 각각 검증, 자기 선언 ID와 출처 정책 |
| 3 | REVIEW-TYPE-01 | worker의 호출 해석 모델·JavaSummaryExtractor, indexer·API 소비자 | 선언형/호출식 타입 분리, javac 기준 78곳과 legacy responseType 보존 |
| 4 | REVIEW-DECL-01 | worker의 선언 추출·모델, 실행 모델 v2·인덱스 | 선언 156개·미초기화 12개, 심볼 가림·초기화/null 상태 분리 |
| 5 | REVIEW-EXEC-01 | worker 공유 식 평가기·메서드 내부 CFG·가드 | 단락 오른쪽 호출 68곳, 중첩/부수 효과·비단락 연산 구별 |
| 6 | AUD2-EXEC-01·02 | 같은 실행 모델에서 continue·반복 갱신·finally·증감 효과 | continue 1곳·증감 4곳, for 갱신·전위/후위·대상 1회 평가 |
| 7 | 7개 항목 공통 | 스키마·인덱스·상세 API·보고서·화면·캐시 | v2/legacy 의미 일치, 전체/증분·변경/삭제·구형 결과 읽기 |
| 별도 | PREP-API-01 | 프로젝트 API 우선 해석과 버전별 API 팩 | provided 의존성·resolver 격리·충돌/누락·소스 대응 |

실행 모델을 공유하는 4–6단계는 공통 스키마를 먼저 맞추고 통합합니다. 각 검수 키의 근거와 완료 판정은 별도로 남깁니다. 실제 필드·호환 계약은 완성 초안을 따릅니다.

## PREP-API-01 — 분석용 API 팩

### 첫 준비 대상

원본 pom.xml에 명시된 정확한 좌표를 사용합니다. Java 8이라는 이유만으로 Servlet 버전을 추측하지 않습니다.

| API | binary 좌표 | 대응 소스 |
| --- | --- | --- |
| Servlet | javax.servlet:javax.servlet-api:4.0.1 | 같은 좌표의 sources JAR |
| JSP | javax.servlet.jsp:javax.servlet.jsp-api:2.3.3 | 같은 좌표의 sources JAR |

현재 기준 분석에 사용한 Tomcat 9.0.102 API/소스와 이 Maven 좌표는 구별합니다. API 명세 버전, artifact 버전, JAR manifest의 provider/version을 서로 같은 문자열로 간주하지 않습니다.

로컬 준비 위치는 `analysis/work-preparation/api-pack-javaee8/`입니다. JAR·sources·POM을 확보하고 공개 checksum 대조, SHA-256, 대표 클래스/Java 소스 존재, manifest 및 LICENSE/NOTICE 경로를 기록합니다. 이는 검증용 로컬 준비본이며 아직 분석기 배포 패키지에 포함하거나 자동 선택하도록 연동한 것이 아닙니다.

정확한 두 좌표의 binary/sources/POM 6개를 확보했고 공개 SHA-1 대조 및 SHA-256 기록이 완료됐습니다. Servlet의 HttpServlet 클래스/소스와 JSP의 JspPage 클래스/소스가 실제로 있습니다. 실제 provider 식별자는 각각 `javax.servlet-api`와 `javax.servlet.jsp-api`로 확인했으며 논리 namespace와 구별합니다.

이 두 API binary와 기존 JSTL 1.2.5만 classpath로 지정해 원본 Java 42개를 Java 8 대상으로 컴파일했습니다. 오류 없이 43개 클래스가 생성됐고 원본 해시는 유지됐습니다. 이 검사는 API 자료의 컴파일 사용 가능성 확인이며 분석기의 solver 격리나 EL을 포함한 전체 연동 검증을 대신하지 않습니다. [준비 검증 근거](2026-11-05-source-audit-work-preparation-evidence.json)에 좌표·해시·검사 범위를 보존했습니다.

Servlet JAR에는 LICENSE 파일이 있지만 JSP JAR은 별도 LICENSE/NOTICE 엔트리 없이 POM의 라이선스 선언을 제공합니다. 제품에 포함하는 단계에서 원문과 출처를 함께 준비하도록 기록했습니다. 파일을 확보한 상태를 재배포 조건 검토 완료로 표시하지 않습니다.

JSP POM은 Servlet 3.0.1과 `javax.el-api [3.0.1-b06,)`를 provided로 선언합니다. 프로젝트의 직접 Servlet 4.0.1을 우선하며, EL이 필요한 타입 해석/변환 범위는 연동 fixture에서 확인합니다. 이 준비본을 전체 Java EE 의존성 묶음으로 간주하거나 EL의 버전 범위를 최신 버전으로 임의 확정하지 않습니다.

### 선택·우선순위 정책

1. 프로젝트의 소스·명시 classpath와 빌드 설정에서 실제 의존성을 먼저 찾습니다. Maven provided도 분석에 필요한 의존성으로 취급합니다.
2. 같은 API의 프로젝트 JAR이 있으면 그것을 사용하고 팩 JAR을 중복 주입하거나 덮어쓰지 않습니다. 버전 충돌은 선택 근거와 함께 표시합니다.
3. 의존성 탐색 이후에도 필요한 API가 없고, 프로젝트에서 버전을 확정할 수 있을 때만 같은 좌표의 팩을 fallback 후보로 사용합니다.
4. 초기 연동 모드는 off/fallback으로 제안하고 기존 설정의 기본은 off로 유지합니다. init에서 정확한 좌표를 확인하면 fallback 설정을 제안할 수 있습니다.
5. 버전 미상·범위 표현·javax/jakarta 불일치·팩 미지원은 사유를 남깁니다. 최신 API나 비슷한 버전을 임의로 대입하지 않습니다.
6. binary는 타입/시그니처, sources는 원본/Javadoc 설명에 사용합니다. 소스가 없어도 binary 해석 성공은 유지하며 문서 제공 상태를 별도로 표시합니다.

### 먼저 해결할 연동 조건

현재 코드 점검에서 다음 선행 조건을 확인했습니다. 이번에 원본 호출 타깃 오류를 새로 확정한 것이 아니라 **프로젝트 API 우선 정책을 보장하기 위한 준비 항목**입니다.

- `java-worker/.../parser/ParserFactory.java`는 ReflectionTypeSolver를 먼저 등록하고, 프로젝트 classpath 로더의 parent로 worker 로더를 사용합니다. 프로젝트 API보다 worker에 포함된 API가 먼저 선택되지 않도록 분석용 solver의 순서·로더 격리를 검증합니다. Java SE 타입 해석은 유지합니다.
- `packages/cli/src/classpath.ts`의 Maven classpath 탐색은 현재 runtime scope를 사용합니다. provided 의존성을 빠뜨린 뒤 팩으로 덮는 방식이 되지 않도록 분석용 scope를 검토하고 fixture로 확인합니다.
- `packages/cli/src/external-symbols.ts`의 provider/version과 source 선택은 manifest 값을 이용합니다. Maven artifact 4.0.1과 예를 들어 명세 표기 4.0.FR을 단순 동등 처리하지 않고, 실제 선택한 binary와 같은 출처의 소스를 연결합니다.
- Jasper 변환용 worker runtime과 분석 대상 프로젝트의 타입 해석 환경은 구별합니다. 분석 팩을 추가해 worker 자체의 Servlet/JSP 실행 의존성을 바꾸지 않습니다.

### 수정할 파일과 준비할 테스트

| 작업 | 대상 |
| --- | --- |
| 설정/팩 manifest 계약 | `packages/schema/src/config.ts`, 패키지 좌표·namespace·hash·provider/source 매핑 |
| 의존성 탐색·선택 | `packages/cli/src/classpath.ts`, `java-classpath.ts`, `jsp-classpath.ts` |
| 대상 타입 해석 환경 | `java-worker/src/main/java/io/lefectjava/worker/parser/ParserFactory.java` |
| API 설명·원본 출처 | `packages/cli/src/external-symbols.ts` |
| 캐시·진단·재현 환경 | `packages/cli/src/index.ts` 및 Java/JSP 의존성 캐시 입력 |
| 패키지에 포함하는 단계 | 팩 manifest와 LICENSE/NOTICE·hash 검증 후 release staging의 포함 목록을 별도로 변경 |

기존 java-index·java/jsp-classpath·external-symbols·JavaRevisionAccuracy 및 증분 테스트를 진입점으로 사용합니다. 제품 코드를 수정할 때 다음 fixture를 추가합니다.

- 명시 프로젝트 API와 팩이 모두 있을 때 프로젝트 버전 선택
- provided만 선언한 프로젝트에서 Maven 탐색 후 올바른 API 확보
- 프로젝트와 worker에 다른 버전의 동명 API가 있을 때 실제 프로젝트 시그니처 선택
- API 누락/정확한 팩/팩 꺼짐/지원하지 않는 버전/namespace 불일치를 각각 구분
- binary 정상·소스 없음, 다른 artifact 버전의 소스, manifest provider 표기 차이
- API 팩 버전·JAR hash·source hash·선택 모드 변경 후 캐시 갱신 및 무변경 시 재사용
- Servlet/JSP를 추가해도 기존 javax의 Java SE API 해석과 Jasper 변환이 유지됨

### 연동 완료 기준

- [ ] 팩의 좌표·binary·source·체크섬·제공 파일 목록을 확인할 수 있습니다.
- [ ] 프로젝트 우선, 정확 버전 fallback, 로더 격리와 provided 탐색을 fixture로 검증합니다.
- [ ] 실제 해석에 사용한 JAR·선택 이유·provider identity와 API 소스 출처가 일치합니다.
- [ ] sources 누락/버전 불일치는 타입 해석 실패와 구별하고 다른 버전의 주석으로 대신하지 않습니다.
- [ ] 선택 모드·팩 좌표/버전·JAR/source hash가 환경 manifest와 캐시 입력에 포함됩니다.
- [ ] 배포용 팩을 포함하는 단계에서는 출처와 해당 LICENSE/NOTICE 파일을 포함하고 패키지 파일 목록을 검증합니다. 현재 로컬 준비만으로 배포 포함 완료로 표시하지 않습니다.

## 첫 작업과 종료 기준

첫 구현 작업은 **AUD2-IMPORT-01**입니다. 해당 코드 수정 전에 현재 116곳의 원본 위치 유실을 재현하고, 수정 뒤 기존 154개 선언 전체를 위치·ID·표기로 대조합니다. 이 작업에 API 팩을 섞어 원인을 바꾸지 않습니다.

API 팩은 별도 준비/연동 작업으로 진행하되 실제 프로젝트와 worker의 API가 충돌하는 fixture를 통과한 뒤 분석 환경에 연결합니다. 다른 7개 보완을 API 팩의 준비 여부 때문에 막지 않습니다.

이번 준비의 종료 기준은 작업 순서·진입점·검증 행렬·기준 해시·정확 버전 API 자료가 준비된 상태입니다. 구현 착수/완료나 새로운 재분석 결과로 표시하지 않습니다. 실제 구현 시 새 결과 디렉터리에서 원본·기존 검수·전체/증분을 다시 비교합니다.

CMS·쿼리·리플렉션 연결 보류, 일반 NPE 경고/전체 메서드 간 분석의 후속 범위, 0.1.8 버전 및 npm 미게시 상태를 유지합니다.
