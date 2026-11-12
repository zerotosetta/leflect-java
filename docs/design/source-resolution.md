# JSP·Java 원문 해석과 MCP

요청서와 수용 기준은 PM 이슈 [won_skill_set#73](https://github.com/zerotosetta/won_skill_set/issues/73)에서 관리한다.

## 원문과 타입

`loadConfig`에서 설정 파일과 워크스페이스를 기준으로 경로를 정규화한다. `SourceWorkspace`는 명시 매핑 또는 등록 루트의 정확한 상대경로를 조회한다. 요청 단위로 탐색 비용을 계산하고, 검증된 원문은 실경로별로 중복 제거한다. 소스 식별자는 경로와 원본 바이트에 연결한다. 원본 바이트의 SHA-256과 실제로 적용한 디코딩을 보존한다.

JavaParser로 선언과 타입 사용 위치를 추출한다. 명시적 import, 같은 패키지, 기본·와일드카드 import 순으로 조사한다. 여러 경로의 후보, 판별할 수 없는 선언·접근 범위와 누락 루트는 근거와 함께 남긴다. 파서의 이름 결합과 실제 후보가 일치할 때 verified로 표시한다. 와일드카드에 대해서는 사용된 타입의 경로를 계산한다. [Java 이름과 import 규칙](https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.5.5.1)

점으로 연결된 이름의 첫 요소가 현재 문맥의 타입이면 실제 소유자 선언에서 멤버를 찾고, 패키지 이름이면 소스에 적힌 경로를 조회한다. 상속으로 보이는 멤버 타입은 import보다 먼저 확인한다. 상속 계층의 근거가 부족하면 다른 후보를 남기고 자동 추적을 보류한다. 일반 파일과 소유자 파일이 같은 이름을 선언하면 두 후보를 기록하며, 해결되지 않은 조회에는 최초 경로를 포함한 시도 경로를 남긴다.

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

## MCP 디버그 로그

`leflect mcp --config <파일>`에 사용하는 기존 설정의 `sourceResolution`에 `logging`을 추가한다. 로그 경로는 설정 파일의 디렉터리를 기준으로 해석한다.

```json
{
  "sourceResolution": {
    "logging": {
      "path": "logs/leflect-mcp.jsonl",
      "includePayloads": true
    }
  }
}
```

UTF-8 JSONL 파일에 실행 시각, 세션·요청 ID, 호출 방향, 도구와 전송 바이트 수를 기록한다. 서버와 Java worker의 시작·종료, 실패 코드, 시간 초과, 취소와 결과 요약도 같은 파일에 기록한다. 기존 파일에는 새 세션의 기록을 이어 쓴다.

원문 탐색은 `lookup.start`부터 `lookup.decision`까지 같은 `lookupId`로 묶인다. `targetIndex`는 요청의 대상 배열에서 1부터 시작하는 순번이다. `sessionId`와 `requestId`가 같은 레코드를 `sequence` 순으로 읽으면 실제 후보 검사 순서를 알 수 있다. `lookup.candidate`에는 루트 ID, 상대 경로와 검사 결과·사유가 기록된다. `lookup.probe`와 `lookup.probe_result`는 현재 패키지나 import 등으로 만든 타입 후보의 결과를 담고, `lookup.decision`은 최종 선택·보류·탈락 후보를 담는다. `lookup.cache`는 조회 결과나 문법 분석 등의 재사용을 기록한다. 파일 바이트의 재사용은 후보 레코드의 `cache`와 `cacheScope`에서 확인할 수 있다.

탐색 메타데이터는 `includePayloads: false`에서도 기록된다. 절대 파일시스템 경로 대신 루트 ID와 상대 경로를 사용한다. JDK 조회는 `lookup.platform`에 클래스 이름과 접근 결과로 기록된다.

`includePayloads`의 기본값은 `false`다. `true`이면 줄 구분자를 제외한 요청·응답을 `payload`에 저장하고 오류 상세와 worker 출력 일부도 기록한다. 이 모드의 로그에는 Java·JSP 원문이 포함될 수 있다. 1 MiB를 넘는 메시지는 크기와 `payloadOmitted`를 기록한다. 대기 중인 로그가 4 MiB를 넘으면 일부 항목을 생략하고 정상 종료 시 `logging.dropped`에 건수를 기록한다.

파일을 열거나 쓸 수 없으면 stderr에 `[leflect-mcp-log]` 경고를 출력하고 MCP 요청 처리를 계속한다. analysis3에서는 `analysis3.json`의 `leflectMcp.logging`에 같은 옵션을 지정할 수 있다.
