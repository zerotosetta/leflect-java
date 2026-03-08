package io.lefectjava.worker.parser;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.lefectjava.worker.model.AstFileResult;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JavaAstExporterTest {
  @Test
  void exportProducesSummaryAndFullJavaParserAstJson() throws Exception {
    Path source = Files.createTempFile("leflect-java-exporter", ".java");
    Files.writeString(
        source,
        """
            package demo;

            import java.util.List;

            class SampleService {
              List<String> items() {
                return List.of("a");
              }
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter();
    JavaAstExporter.ExportResult result = exporter.export(source, "src/demo/SampleService.java", "java");

    AstFileResult summary = result.ast;
    assertEquals("demo", summary.packageName);
    assertEquals(1, summary.types.size());
    assertEquals("demo.SampleService", summary.types.get(0).fqn);
    assertFalse(result.rawAstJson.isBlank());

    ObjectMapper mapper = new ObjectMapper();
    JsonNode root = mapper.readTree(result.rawAstJson);
    assertEquals("com.github.javaparser.ast.CompilationUnit", root.get("!").asText());
    assertNotNull(root.get("types"));
    assertTrue(root.get("types").isArray());
    assertNotNull(root.get("tokenRange"));
    assertEquals(
        "SampleService",
        root.get("types").get(0).get("name").get("identifier").asText()
    );
    assertEquals(
        "items",
        root.get("types").get(0).get("members").get(0).get("name").get("identifier").asText()
    );
  }
}
