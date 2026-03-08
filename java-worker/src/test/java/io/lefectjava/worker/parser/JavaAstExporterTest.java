package io.lefectjava.worker.parser;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.lefectjava.worker.model.AstFileResult;
import org.junit.jupiter.api.Test;

import javax.tools.ToolProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
    assertTrue(result.problems.isEmpty());
  }

  @Test
  void exportCapturesDetailedParseProblems() throws Exception {
    Path source = Files.createTempFile("leflect-java-broken", ".java");
    Files.writeString(
        source,
        """
            package demo;
            class Broken {
              void run( }
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter();
    JavaAstExporter.ExportResult result = exporter.export(source, "src/demo/Broken.java", "java");

    assertFalse(result.problems.isEmpty());
    assertEquals("java-parse", result.problems.get(0).stage);
    assertEquals("java.parse.problem", result.problems.get(0).category);
    assertNotNull(result.problems.get(0).location);
    assertNotNull(result.problems.get(0).snippet);
    assertNull(result.problems.get(0).generatedPath);
  }

  @Test
  void exportResolvesExternalMethodCallsWhenClasspathIsProvided() throws Exception {
    Path root = Files.createTempDirectory("leflect-java-symbol-root");
    Path externalSourceRoot = root.resolve("external-src");
    Path externalSource = externalSourceRoot.resolve("support/ExternalUtil.java");
    Path externalClasses = root.resolve("external-classes");
    Path sourceRoot = root.resolve("src/main/java");
    Path source = sourceRoot.resolve("demo/SampleService.java");

    Files.createDirectories(externalSource.getParent());
    Files.createDirectories(externalClasses);
    Files.writeString(
        externalSource,
        """
            package support;
            public class ExternalUtil {
              public static void work() {
              }
            }
            """
    );
    compileJava(externalClasses, externalSource);

    Files.createDirectories(source.getParent());
    Files.writeString(
        source,
        """
            package demo;

            import support.ExternalUtil;

            class SampleService {
              void run() {
                ExternalUtil.work();
              }
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter(
        ParserFactory.createJavaParser(root, List.of(source), List.of(externalClasses.toString())),
        new JavaSummaryExtractor(),
        new ParseProblemCollector(),
        new JavaParserAstSerializer()
    );
    JavaAstExporter.ExportResult result = exporter.export(source, "src/main/java/demo/SampleService.java", "java");

    assertTrue(result.problems.isEmpty());
    assertEquals(
        "support.ExternalUtil#work()",
        result.ast.types.get(0).methods.get(0).calls.get(0)
    );
  }

  private static void compileJava(Path outputDir, Path source) throws Exception {
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      throw new IllegalStateException("JDK compiler is not available");
    }

    int exitCode = compiler.run(
        null,
        null,
        null,
        "-d",
        outputDir.toString(),
        source.toString()
    );

    assertEquals(0, exitCode);
  }
}
