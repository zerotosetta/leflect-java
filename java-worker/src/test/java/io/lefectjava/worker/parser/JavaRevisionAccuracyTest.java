package io.lefectjava.worker.parser;

import io.lefectjava.worker.model.AstFileResult;
import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class JavaRevisionAccuracyTest {
  private AstFileResult export(String text) throws Exception {
    Path root = Files.createTempDirectory("leflect-revision-");
    Path source = root.resolve("demo/Uses.java");
    Files.createDirectories(source.getParent());
    Files.writeString(source, text);
    return new JavaAstExporter(ParserFactory.createJavaParser(root, List.of(source), List.of()),
        new JavaSummaryExtractor(), new ParseProblemCollector(), new JavaParserAstSerializer())
        .export(source, "demo/Uses.java", "java").ast;
  }

  @Test
  void staticQualifiersUseResolvedSymbolsAndKeepRepeatedSourceSites() throws Exception {
    AstFileResult result = export("""
        package demo;
        import java.util.Locale;
        class Uses {
          enum DayOfWeek { HOME }
          static class Holder { int value; }
          void run() {
            Object local = DayOfWeek.HOME;
            Object first = java.time.DayOfWeek.SUNDAY;
            Object second = java.time.DayOfWeek.SUNDAY;
            Object locale = Locale.ROOT;
            int max = java.lang.Integer.MAX_VALUE;
            Holder UPPERCASE = new Holder();
            int value = UPPERCASE.value;
            int unresolved = Missing.VALUE;
          }
        }
        """);
    var qualifiers = result.classReferences.stream().filter(r -> "static-qualifier".equals(r.kind)).toList();
    assertEquals(5, qualifiers.size());
    assertTrue(qualifiers.stream().anyMatch(r -> r.resolvedClassId.equals("demo.Uses.DayOfWeek") && r.location.line == 7));
    var repeated = qualifiers.stream().filter(r -> r.resolvedClassId.equals("java.time.DayOfWeek")).toList();
    assertEquals(List.of(8, 9), repeated.stream().map(r -> r.location.line).toList());
    assertTrue(qualifiers.stream().anyMatch(r -> r.resolvedClassId.equals("java.util.Locale")));
    assertTrue(qualifiers.stream().anyMatch(r -> r.resolvedClassId.equals("java.lang.Integer")));
    assertFalse(qualifiers.stream().anyMatch(r -> r.symbol.equals("UPPERCASE") || r.symbol.equals("Missing")));
    assertFalse(result.classReferences.stream().anyMatch(r -> List.of("java", "java.time", "java.lang").contains(r.qualifiedName)));
    assertTrue(result.referenceDiagnostics.stream().anyMatch(d -> d.snippet.equals("Missing") && d.location.line == 14));
  }
}
