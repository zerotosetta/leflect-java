package io.lefectjava.worker.parser;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.lefectjava.worker.model.AstFileResult;
import org.junit.jupiter.api.Test;

import javax.tools.ToolProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

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
    assertTrue(summary.classReferences.size() >= 1);
    assertTrue(
        summary.classReferences.stream()
            .anyMatch(reference -> "java.util.List".equals(reference.qualifiedName))
    );
    assertTrue(
        summary.classReferences.stream()
            .anyMatch(reference -> "List".equals(reference.name) && "java.util.List".equals(reference.resolvedClassId))
    );
    assertNotNull(summary.types.get(0).location);
    assertNotNull(summary.types.get(0).lineRange);
    assertNotNull(summary.types.get(0).methods.get(0).location);
    assertNotNull(summary.types.get(0).methods.get(0).lineRange);
    assertEquals(2, summary.types.get(0).methods.get(0).orderedSteps.size());
    assertEquals("call", summary.types.get(0).methods.get(0).orderedSteps.get(0).kind);
    assertEquals("List.of", summary.types.get(0).methods.get(0).orderedSteps.get(0).call.targetText);
    assertEquals("return", summary.types.get(0).methods.get(0).orderedSteps.get(1).kind);
    assertEquals(1, summary.methodCalls.size());
    assertTrue(summary.methodCalls.get(0).target.contains("of"));
    assertEquals("List.of", summary.methodCalls.get(0).targetText);
    assertEquals(summary.methodCalls.get(0).targetClassId, summary.methodCalls.get(0).resolvedClassId);
    assertEquals(summary.methodCalls.get(0).targetMethodId, summary.methodCalls.get(0).resolvedMethodId);
    assertEquals("of", summary.methodCalls.get(0).targetMethodName);
    assertEquals("\"a\"", summary.methodCalls.get(0).argumentExpressions.get(0));
    assertNotNull(summary.methodCalls.get(0).location);
    assertNotNull(summary.methodCalls.get(0).lineRange);
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
    assertEquals(1, result.ast.methodCalls.size());
    assertEquals("support.ExternalUtil#work()", result.ast.methodCalls.get(0).target);
    assertEquals("work", result.ast.methodCalls.get(0).targetMethodName);
    assertEquals("support.ExternalUtil", result.ast.methodCalls.get(0).classPath);
    assertEquals(0, result.ast.methodCalls.get(0).parameterTypes.size());
    assertEquals(0, result.ast.methodCalls.get(0).argumentExpressions.size());
    assertEquals("void", result.ast.methodCalls.get(0).responseType);
    assertNotNull(result.ast.methodCalls.get(0).location);
  }

  @Test
  void exportFallsBackToResolvedScopeTypeForGenericCollectionCalls() throws Exception {
    Path root = Files.createTempDirectory("leflect-java-generic-root");
    Path sourceRoot = root.resolve("src/main/java");
    Path source = sourceRoot.resolve("demo/SampleService.java");

    Files.createDirectories(source.getParent());
    Files.writeString(
        source,
        """
            package demo;

            import java.util.ArrayList;
            import java.util.List;

            class Check {
            }

            class SampleService {
              private final List<Check> checks = new ArrayList<>();

              void add(Check check) {
                this.checks.add(unknown(check));
              }
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter(
        ParserFactory.createJavaParser(root, List.of(source), List.of()),
        new JavaSummaryExtractor(),
        new ParseProblemCollector(),
        new JavaParserAstSerializer()
    );
    JavaAstExporter.ExportResult result = exporter.export(source, "src/main/java/demo/SampleService.java", "java");

    assertTrue(result.problems.isEmpty());
    var addCall = result.ast.methodCalls.stream()
        .filter(call -> "add".equals(call.targetMethodName))
        .findFirst()
        .orElseThrow();

    assertEquals("java.util.List", addCall.classPath);
    assertTrue(addCall.target.startsWith("java.util.List#add("));
    assertEquals(1, addCall.parameterTypes.size());
    assertTrue(addCall.parameterTypes.get(0).endsWith("Check"));
    assertEquals("boolean", addCall.responseType);
    assertEquals("unknown(check)", addCall.argumentExpressions.get(0));
  }

  @Test
  void exportCapturesFieldMetadataInSummary() throws Exception {
    Path source = Files.createTempFile("leflect-java-fields", ".java");
    Files.writeString(
        source,
        """
            package demo;

            import java.util.List;

            class Support {
            }

            class SampleService {
              private final List<String> foos = List.of("a");
              static Support INSTANCE = new Support();
              String alias = "named";
              int a, b = 1;
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter();
    JavaAstExporter.ExportResult result = exporter.export(source, "src/demo/SampleService.java", "java");

    var sampleService = result.ast.types.stream()
        .filter(type -> "demo.SampleService".equals(type.fqn))
        .findFirst()
        .orElseThrow();
    Map<String, ?> fieldsById = sampleService.fields.stream()
        .collect(java.util.stream.Collectors.toMap(field -> field.id, field -> field));

    assertEquals(5, sampleService.fields.size());

    var foos = sampleService.fields.stream()
        .filter(field -> "demo.SampleService#foos".equals(field.id))
        .findFirst()
        .orElseThrow();
    assertEquals("List<String>", foos.declaredType);
    assertEquals("List<String>", foos.type);
    assertEquals(List.of("private", "final"), foos.modifiers);
    assertEquals("instance", foos.lifetime);
    assertEquals("List.of(\"a\")", foos.initializerSnippet);
    assertNotNull(foos.location);
    assertNotNull(foos.lineRange);

    var instance = sampleService.fields.stream()
        .filter(field -> "demo.SampleService#INSTANCE".equals(field.id))
        .findFirst()
        .orElseThrow();
    assertEquals("Support", instance.declaredType);
    assertEquals("Support", instance.type);
    assertEquals(List.of("static"), instance.modifiers);
    assertEquals("class", instance.lifetime);
    assertEquals("new Support()", instance.initializerSnippet);

    var alias = sampleService.fields.stream()
        .filter(field -> "demo.SampleService#alias".equals(field.id))
        .findFirst()
        .orElseThrow();
    assertTrue(alias.modifiers.isEmpty());
    assertEquals("instance", alias.lifetime);
    assertEquals("\"named\"", alias.initializerSnippet);

    assertTrue(fieldsById.containsKey("demo.SampleService#a"));
    assertTrue(fieldsById.containsKey("demo.SampleService#b"));
    assertNull(sampleService.fields.stream()
        .filter(field -> "demo.SampleService#a".equals(field.id))
        .findFirst()
        .orElseThrow()
        .initializerSnippet);
    assertEquals("1", sampleService.fields.stream()
        .filter(field -> "demo.SampleService#b".equals(field.id))
        .findFirst()
        .orElseThrow()
        .initializerSnippet);
  }

  @Test
  void exportCapturesOrderedExecutionStepsWithBranchPaths() throws Exception {
    Path source = Files.createTempFile("leflect-java-ordered-steps", ".java");
    Files.writeString(
        source,
        """
            package demo;

            class SampleService {
              void run(boolean ready) {
                if (ready) {
                  work();
                } else {
                  recover();
                }

                for (int i = 0; i < 2; i++) {
                  process(i);
                }
              }

              void work() {
              }

              void recover() {
              }

              void process(int value) {
              }
            }
            """
    );

    JavaAstExporter exporter = new JavaAstExporter();
    JavaAstExporter.ExportResult result = exporter.export(source, "src/demo/SampleService.java", "java");

    var runMethod = result.ast.types.get(0).methods.stream()
        .filter(method -> "run".equals(method.name))
        .findFirst()
        .orElseThrow();

    assertFalse(runMethod.orderedSteps.isEmpty());
    assertEquals("branch", runMethod.orderedSteps.get(0).kind);
    assertTrue(runMethod.orderedSteps.stream().anyMatch(step ->
        "call".equals(step.kind) &&
            step.branchPath.equals(List.of("if:true")) &&
            step.call != null &&
            "work".equals(step.call.methodName)
    ));
    assertTrue(runMethod.orderedSteps.stream().anyMatch(step ->
        "call".equals(step.kind) &&
            step.branchPath.equals(List.of("if:false")) &&
            step.call != null &&
            "recover".equals(step.call.methodName)
    ));
    assertTrue(runMethod.orderedSteps.stream().anyMatch(step ->
        "call".equals(step.kind) &&
            step.branchPath.equals(List.of("for:body")) &&
            step.call != null &&
            "process".equals(step.call.methodName)
    ));
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
