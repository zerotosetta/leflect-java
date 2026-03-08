package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    assertTrue(node.has("location"));
    assertTrue(node.has("snippet"));
  }

  private static String escapeJson(Path path) {
    return path.toString().replace("\\", "\\\\");
  }
}
