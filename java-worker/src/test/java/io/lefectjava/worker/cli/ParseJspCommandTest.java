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

  private static String escapeJson(Path path) {
    return path.toString().replace("\\", "\\\\");
  }
}
