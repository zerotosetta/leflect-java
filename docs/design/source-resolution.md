# JSP·Java 원문 해석과 MCP

요청서와 수용 기준은 PM 이슈 [won_skill_set#73](https://github.com/zerotosetta/won_skill_set/issues/73)에서 관리한다.

## 원문과 타입

`loadConfig`에서 설정 파일과 워크스페이스를 기준으로 경로를 정규화한다. `SourceWorkspace`는 명시 매핑 또는 등록 루트의 정확한 상대경로를 조회한다. 요청 단위로 탐색 비용을 계산하고, 검증된 원문은 실경로별로 중복 제거한다. 소스 식별자는 경로와 원본 바이트에 연결한다. 원본 바이트의 SHA-256과 실제로 적용한 디코딩을 보존한다.

JavaParser로 선언과 타입 사용 위치를 추출한다. 명시적 import, 같은 패키지, 기본·와일드카드 import 순으로 조사한다. 여러 경로의 후보, 판별할 수 없는 선언·접근 범위와 누락 루트는 근거와 함께 남긴다. 파서의 이름 결합과 실제 후보가 일치할 때 verified로 표시한다. 와일드카드에 대해서는 사용된 타입의 경로를 계산한다. [Java 이름과 import 규칙](https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.5.5.1)

JSP 정적 include는 한 번역 단위에서 코드와 import를 합치고 각 조각의 원본 위치를 연결한다. 요청 시 include는 별도 페이지 문맥을 사용한다. 각 include 경로와 순환을 원문 위치와 함께 기록한다. 같은 조각을 다른 페이지에서 읽으면 해당 페이지의 import 문맥으로 다시 해석한다. [Jakarta Server Pages 3.1](https://jakarta.ee/specifications/pages/3.1/jakarta-server-pages-spec-3.1.pdf)

## 스냅샷과 호출

`createSourceResolution`과 `leflect mcp --config <파일>`은 동일한 원문 해석을 사용한다. `resolve_references`는 명시 대상을 먼저 기록하고, 번역 단위와 요청 범위 안의 의존성을 탐색한다. `get_source`는 스냅샷의 원본 바이트 또는 디코딩한 행 범위를 읽는다. `analyze_sources`는 수집된 원문에서 클래스, 메서드, 호출, 파서 진단을 추출한다.

```sh
leflect mcp --config ./atk-configs/leflect.config.json
```

설정 예시는 [요청서의 워크스페이스 계약](https://github.com/zerotosetta/won_skill_set-axpm/blob/main/docs/leflect-java-mcp-spec.md#3-워크스페이스-설정과-경로-계약)을 따른다. `get_source`의 `bytes` 응답은 구간별 `data`를 base64로 제공한다. `text` 응답의 끝 행·열은 구간 뒤의 위치이며 긴 행도 페이지에 나뉠 수 있다.

스냅샷을 확장할 때 원본 스냅샷의 바이트와 출처를 재사용한다. 새 요청은 고정된 서버 설정을 사용하고, 기존 스냅샷은 세션 메모리에 보관한다. 페이지 커서는 같은 서버와 도구의 산출 결과를 이어 읽는다. stdout은 줄 단위 UTF-8 JSON-RPC로 사용한다. 구조화 결과와 동일 내용의 호환 텍스트를 전송 바이트 한도에 포함한다. [MCP 도구](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) · [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

클라이언트는 `nextCursor`가 null이 될 때까지 같은 도구를 호출하고 각 배열을 이어 붙인다. 단일 레코드가 응답 한도를 넘으면 `fragments`에 JSON 문자열 조각이 온다. `section`과 `index`가 같은 조각을 UTF-16 `offset` 순으로 모아 `last`에서 파싱하고 해당 배열에 추가한다.

Java 원문은 고정된 텍스트로 worker에 전달한다. JSP 스크립틀릿과 선언은 번역 단위별 Java 입력으로 묶고, worker가 반환한 위치를 JSP 원문에 대응시킨다. 태그 라이브러리와 컨테이너의 실행 결과가 필요한 경로는 진단에 남긴다.

analysis3 0.1.5에서는 `leflectMcp.cli`에 이 변경을 포함한 LeflectJava 빌드의 CLI 경로를 지정한다. MCP 도구의 결과는 스키마 버전 1을 사용하며, 정적분석의 `parserVersion`에 실제 worker JAR의 SHA-256을 담는다. [analysis3 연동 PR](https://github.com/zerotosetta/won_skill_set/pull/74)
