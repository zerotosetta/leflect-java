package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ParseJspCommandTest {
  @Test
  void parseJspWritesOneToOneFullAstJsonFile() throws Exception {
    Path root = Files.createTempDirectory("leflect-jsp-root");
    Path webappRoot = root.resolve("src/main/webapp");
    Path jspSource = webappRoot.resolve("views/home.jsp");
    Path servletOutputDir = root.resolve("analysis/generated-jsp-java");
    Path astOutputDir = root.resolve("analysis/jsp-ast");
    Path errorLog = root.resolve("analysis/logs/jsp-parse-errors.jsonl");
    Path manifestPath = root.resolve("jsp-manifest.json");

    Files.createDirectories(jspSource.getParent());
    Files.writeString(
        jspSource,
        """
            <%@ page contentType="text/html; charset=UTF-8" %>
            <html>
            <body>
            <%= \"hello\" %>
            </body>
            </html>
            """
    );

    Files.writeString(
        manifestPath,
        """
            {
              "root": "%s",
              "files": ["src/main/webapp/views/home.jsp"],
              "webappRoot": "%s",
              "servletOutputDir": "%s",
              "astOutputDir": "%s",
              "errorLog": "%s"
            }
            """.formatted(
            escapeJson(root),
            escapeJson(webappRoot),
            escapeJson(servletOutputDir),
            escapeJson(astOutputDir),
            escapeJson(errorLog)
        )
    );

    ParseJspCommand command = new ParseJspCommand();
    int exitCode = command.run(new WorkerOptions(manifestPath.toString()));

    assertEquals(0, exitCode);

    Path astPath = astOutputDir.resolve("src/main/webapp/views/home.jsp.json");
    assertTrue(Files.exists(astPath));

    ObjectMapper mapper = new ObjectMapper();
    JsonNode rootNode = mapper.readTree(Files.readString(astPath));
    assertEquals("com.github.javaparser.ast.CompilationUnit", rootNode.get("!").asText());
    assertTrue(rootNode.has("types"));
  }

  @Test
  void parseJspWritesDetailedErrorLogForMissingTaglibUri() throws Exception {
    Path root = Files.createTempDirectory("leflect-jsp-error-root");
    Path webappRoot = root.resolve("src/main/webapp");
    Path jspSource = webappRoot.resolve("views/home.jsp");
    Path servletOutputDir = root.resolve("analysis/generated-jsp-java");
    Path astOutputDir = root.resolve("analysis/jsp-ast");
    Path errorLog = root.resolve("analysis/logs/jsp-parse-errors.jsonl");
    Path manifestPath = root.resolve("jsp-manifest.json");

    Files.createDirectories(jspSource.getParent());
    Files.writeString(
        jspSource,
        """
            <%@ taglib prefix="spring" uri="http://www.springframework.org/tags" %>
            <spring:message code="welcome" />
            """
    );

    Files.writeString(
        manifestPath,
        """
            {
              "root": "%s",
              "files": ["src/main/webapp/views/home.jsp"],
              "webappRoot": "%s",
              "servletOutputDir": "%s",
              "astOutputDir": "%s",
              "errorLog": "%s"
            }
            """.formatted(
            escapeJson(root),
            escapeJson(webappRoot),
            escapeJson(servletOutputDir),
            escapeJson(astOutputDir),
            escapeJson(errorLog)
        )
    );

    ParseJspCommand command = new ParseJspCommand();
    int exitCode = command.run(new WorkerOptions(manifestPath.toString()));

    assertEquals(0, exitCode);
    assertTrue(Files.exists(errorLog));

    ObjectMapper mapper = new ObjectMapper();
    String firstLine = Files.readAllLines(errorLog).get(0);
    JsonNode node = mapper.readTree(firstLine);

    assertEquals("jsp-parse", node.get("stage").asText());
    assertEquals("jsp.taglib.uri.unresolved", node.get("category").asText());
    assertEquals("src/main/webapp/views/home.jsp", node.get("path").asText());
    assertEquals("http://www.springframework.org/tags", node.get("relatedUri").asText());
    assertEquals("org.apache.jasper.JasperException", node.get("rootCauseClass").asText());
    assertTrue(node.get("rootCauseMessage").asText().contains("http://www.springframework.org/tags"));
    assertTrue(node.get("stackTrace").asText().contains("ParseJspCommand"));
    assertTrue(node.get("workerDiagnostics").asText().contains("absolute uri"));
    assertTrue(node.get("causeChain").isArray());
    assertTrue(node.get("unresolvedTaglibUris").isArray());
    assertEquals("http://www.springframework.org/tags", node.get("unresolvedTaglibUris").get(0).asText());
    assertTrue(node.has("location"));
    assertTrue(node.has("snippet"));
  }

  @Test
  void parseJspReportsMissingIncludePathWithFullDiagnostics() throws Exception {
    Path root = Files.createTempDirectory("leflect-jsp-missing-include-root");
    Path webappRoot = root.resolve("src/main/webapp");
    Path jspSource = webappRoot.resolve("views/home.jsp");
    Path servletOutputDir = root.resolve("analysis/generated-jsp-java");
    Path astOutputDir = root.resolve("analysis/jsp-ast");
    Path errorLog = root.resolve("analysis/logs/jsp-parse-errors.jsonl");
    Path manifestPath = root.resolve("jsp-manifest.json");

    Files.createDirectories(jspSource.getParent());
    Files.writeString(
        jspSource,
        """
            <%@ include file="/WEB-INF/jsp/shared/header.jsp" %>
            <html>
            <body>broken</body>
            </html>
            """
    );

    Files.writeString(
        manifestPath,
        """
            {
              "root": "%s",
              "files": ["src/main/webapp/views/home.jsp"],
              "webappRoot": "%s",
              "servletOutputDir": "%s",
              "astOutputDir": "%s",
              "errorLog": "%s"
            }
            """.formatted(
            escapeJson(root),
            escapeJson(webappRoot),
            escapeJson(servletOutputDir),
            escapeJson(astOutputDir),
            escapeJson(errorLog)
        )
    );

    ParseJspCommand command = new ParseJspCommand();
    int exitCode = command.run(new WorkerOptions(manifestPath.toString()));

    assertEquals(0, exitCode);
    assertTrue(Files.exists(errorLog));

    ObjectMapper mapper = new ObjectMapper();
    String firstLine = Files.readAllLines(errorLog).get(0);
    JsonNode node = mapper.readTree(firstLine);

    assertEquals("jsp.include.notFound", node.get("category").asText());
    assertEquals("Included JSP file could not be resolved", node.get("summary").asText());
    assertEquals("org.apache.jasper.JasperException", node.get("rootCauseClass").asText());
    assertTrue(node.get("rootCauseMessage").asText().contains("/WEB-INF/jsp/shared/header.jsp"));
    assertTrue(node.get("workerDiagnostics").asText().contains("JSP file [/WEB-INF/jsp/shared/header.jsp] not found"));
    assertTrue(node.get("stackTrace").asText().contains("JspCompilationFailure"));
    assertTrue(node.get("missingPaths").isArray());
    assertEquals("/WEB-INF/jsp/shared/header.jsp", node.get("missingPaths").get(0).asText());
    assertTrue(node.has("location"));
    assertEquals(1, node.get("location").get("line").asInt());
    assertTrue(node.get("snippet").asText().contains("/WEB-INF/jsp/shared/header.jsp"));
    assertNotNull(node.get("causeChain"));
  }

  private static String escapeJson(Path path) {
    return path.toString().replace("\\", "\\\\");
  }
}
