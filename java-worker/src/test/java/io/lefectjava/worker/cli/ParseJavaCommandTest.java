package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ParseJavaCommandTest {
  @Test
  void parseJavaWritesDetailedProblemLogWithLocation() throws Exception {
    Path root = Files.createTempDirectory("leflect-java-root");
    Path source = root.resolve("src/demo/Broken.java");
    Path astOutputDir = root.resolve("analysis/java-ast");
    Path errorLog = root.resolve("analysis/logs/java-parse-errors.jsonl");
    Path manifestPath = root.resolve("java-manifest.json");

    Files.createDirectories(source.getParent());
    Files.writeString(
        source,
        """
            package demo;
            class Broken {
              void run( }
            }
            """
    );

    Files.writeString(
        manifestPath,
        """
            {
              "root": "%s",
              "files": ["src/demo/Broken.java"],
              "outputDir": "%s",
              "errorLog": "%s"
            }
            """.formatted(
            escapeJson(root),
            escapeJson(astOutputDir),
            escapeJson(errorLog)
        )
    );

    ParseJavaCommand command = new ParseJavaCommand();
    int exitCode = command.run(new WorkerOptions(manifestPath.toString()));

    assertEquals(0, exitCode);
    assertTrue(Files.exists(errorLog));

    ObjectMapper mapper = new ObjectMapper();
    String firstLine = Files.readAllLines(errorLog).get(0);
    JsonNode node = mapper.readTree(firstLine);

    assertEquals("java-parse", node.get("stage").asText());
    assertEquals("java.parse.problem", node.get("category").asText());
    assertEquals("src/demo/Broken.java", node.get("path").asText());
    assertTrue(node.has("location"));
    assertTrue(node.has("snippet"));
  }

  private static String escapeJson(Path path) {
    return path.toString().replace("\\", "\\\\");
  }
}
