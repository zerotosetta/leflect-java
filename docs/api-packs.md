# 분석용 API 팩

API 팩은 프로젝트가 선언한 의존성을 구할 수 없을 때 정확한 좌표의 API를 분석에 제공하는 로컬 자료입니다. 기본 모드는 `off`이며, `java.apiPacks.mode: "fallback"`으로 켭니다. API 팩을 사용해도 분석기 버전은 0.1.8이며 npm 게시나 배포 태그를 만들지 않습니다.

## 선택 순서

프로젝트 소스, 명시 classpath, Maven에서 구한 의존성이 우선합니다. Maven classpath는 `compile`과 `runtime` 범위의 합집합이므로 `provided`와 `system` 의존성도 포함하고 test 의존성은 주입하지 않습니다. 같은 API namespace의 프로젝트 binary가 있으면 팩 binary를 추가하지 않습니다. 버전 충돌이 있어도 실제 프로젝트 provider를 유지하고 진단에 선택 근거를 남깁니다.

프로젝트 POM과 로컬 parent의 직접 의존성, properties, dependencyManagement에서 정확한 좌표를 얻은 경우에만 같은 팩을 선택합니다. 해결하지 못한 parent/BOM/property, 미상 버전, 범위, `LATEST`/`RELEASE`를 임의 버전으로 바꾸지 않습니다. `javax`와 `jakarta`도 자동 변환하지 않습니다. 팩에 없는 좌표는 프로젝트 환경에서 별도로 제공해야 합니다. Servlet/JSP 두 자료를 전체 Java EE 의존성으로 간주하지 않으며 EL 버전 범위를 자동 확정하지 않습니다.

Java resolver는 프로젝트 소스, 순서대로 지정한 binary classpath, Java SE 순으로 타입을 찾습니다. JAR는 `JarTypeSolver`로 시그니처를 읽으며, 디렉터리 class loader는 platform loader를 parent로 사용합니다. 분석기의 Jasper/Servlet runtime이 프로젝트의 API로 노출되지 않고 Java SE의 `javax.crypto`, `javax.sql` 등은 계속 사용할 수 있습니다. Jasper 변환용 runtime 구성은 유지됩니다.

## 설정

```json
{
  "classpathDiscovery": { "enabled": false },
  "java": {
    "classpath": ["lib/project-api.jar", "target/classes"],
    "mavenClasspath": false,
    "apiPacks": { "mode": "fallback" }
  },
  "jsp": {
    "classpath": ["lib/project-api.jar", "target/classes"],
    "mavenClasspath": false
  }
}
```

`mavenClasspath` 기본값은 `true`입니다. 위 예시는 명시 classpath와 팩만 사용하는 재현용 환경으로 Maven과 시스템 탐색을 끕니다. 일반 Maven 프로젝트에서는 `mavenClasspath`를 생략해 프로젝트의 실제 의존성을 먼저 찾게 합니다. `java.apiPacks.directory`를 지정하면 해당 디렉터리의 검증 가능한 `manifest.json`을 사용합니다. 상대 경로는 프로젝트 root 기준입니다.

## 결과와 소스 출처

`analysisOut/manifests/api-packs-java.json`과 `api-packs-jsp.json`에서 모드, 팩 ID, 실제 classpath, 좌표별 선택 결과(`project`, `pack`, `unavailable`), 선택 이유, provider 이름/버전/경로, binary/source SHA-256과 진단을 확인합니다. 팩 꺼짐은 `mode: "off"`와 빈 선택 목록으로 표시됩니다. 버전 미확정, 미지원 좌표/namespace, 프로젝트 버전 충돌, 무결성 실패, 소스 없음/버전 불일치는 각각 진단 코드를 남깁니다.

binary는 타입과 시그니처 해석에, sources는 원본과 Javadoc 제공에 사용합니다. 소스가 없거나 다른 버전이면 binary 해석 성공은 유지하고 문서 제공 상태를 별도로 기록합니다. 실제 provider identity와 artifact 버전을 보존하며 명세 표기인 `4.0.FR` 등을 Maven artifact `4.0.1`과 같은 문자열로 취급하지 않습니다. 프로젝트 binary가 팩의 원본 binary와 byte 단위로 같고 provider/version도 일치하면 대응 소스만 재사용할 수 있습니다. 다른 프로젝트 binary에 팩의 주석을 대신 연결하지 않습니다.

모드, 팩 manifest, 정확한 좌표, binary/source/POM 및 고지 파일의 해시가 의존성 캐시 입력에 포함됩니다. 소스만 변경되거나 사라져도 캐시가 갱신됩니다. source archive의 내장 POM 좌표도 대조하므로 checksum이 유효한 다른 버전 소스로 바뀐 경우를 구분합니다.

## 포함 자료와 패키징

`resources/api-packs/manifest.json`에는 아래 Maven Central 원본의 URL, SHA-256, 제공 파일과 실제 provider가 있습니다.

| 좌표 | binary | sources | POM |
| --- | --- | --- | --- |
| `javax.servlet:javax.servlet-api:4.0.1` | 포함 | 같은 좌표 포함 | 포함 |
| `javax.servlet.jsp:javax.servlet.jsp-api:2.3.3` | 포함 | 같은 좌표 포함 | 포함 |

두 원본 POM은 CDDL + GPLv2 Classpath Exception을 선언합니다. Servlet archive의 `META-INF/LICENSE.txt` 원문은 `LICENSE-CDDL-GPL-CLASSPATH.txt`에 보존했습니다. 별도 LICENSE 엔트리가 없는 JSP archive는 원본 POM과 소스 헤더를 유지하며 경위를 `NOTICE.md`에 기록했습니다. 각 파일과 고지문의 해시도 manifest에 있습니다. 이는 포함 파일 및 출처 기록입니다.

scoped CLI와 NPX 패키지의 staging은 `api-packs/`를 포함하고, binary 패키지는 같은 자료를 asset으로 포함합니다. binary 실행 시 Java가 읽을 수 있도록 자료를 manifest 해시별 임시 디렉터리에 풀고 다시 무결성을 확인합니다. 패키징 변경은 npm 게시를 실행하지 않습니다.
