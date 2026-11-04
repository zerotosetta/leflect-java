package io.lefectjava.worker.parser;

import io.lefectjava.worker.model.AstFileResult;
import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class JavaRevisionAccuracyTest {
  @Test
  void inheritedStaticMemberRetainsTheWrittenQualifierType() throws Exception {
    AstFileResult result = export("""
        package demo;
        class Base { static int VALUE = 1; }
        class Child extends Base {}
        class Uses { int read() { return Child.VALUE; } }
        """);
    var qualifier = result.classReferences.stream().filter(r -> "static-qualifier".equals(r.kind))
        .findFirst().orElseThrow();
    assertEquals("Child", qualifier.symbol);
    assertEquals("demo.Child", qualifier.resolvedClassId);
    assertEquals(4, qualifier.location.line);
  }

  @Test
  void explicitThisWritesResolveFieldOwnersDespiteParameterAndLocalShadowing() throws Exception {
    AstFileResult result = export("""
        package demo;
        class Base { int inherited; int hidden; }
        class Uses extends Base {
          int value; int id; int hidden;
          Uses(int value, int inherited) {
            this.value = value;
            value = 2;
            this.inherited = inherited;
            this.id = 7;
            this.hidden = 3;
            { int id = 1; id = 2; }
            id = 8;
          }
        }
        """);
    var ctor = result.types.stream().filter(t -> t.fqn.equals("demo.Uses")).findFirst().orElseThrow().methods.get(0);
    var writes = ctor.orderedSteps.stream().filter(s -> s.kind.equals("field-write")).toList();
    assertEquals(5, writes.size());
    assertTrue(writes.stream().anyMatch(s -> s.field.id.equals("demo.Base#inherited")));
    assertTrue(writes.stream().anyMatch(s -> s.field.id.equals("demo.Uses#hidden")));
    assertEquals(2, writes.stream().filter(s -> s.field.id.equals("demo.Uses#id")).count());
    assertTrue(ctor.orderedSteps.stream().anyMatch(s -> s.snippet.equals("value = 2") && s.kind.equals("assignment") && s.field == null));
    assertTrue(ctor.orderedSteps.stream().anyMatch(s -> s.snippet.equals("id = 2") && s.kind.equals("assignment") && s.field == null));
  }

  @Test
  void explicitConstructorDelegationSharesTargetsRangesAndEvaluationOrder() throws Exception {
    AstFileResult result = export("""
        package demo;
        class Uses extends RuntimeException {
          String value;
          static String text() { return "message"; }
          Uses() { this(text()); }
          Uses(String message) { super(message); value = message; }
          Uses(int unknown) { super(missing(unknown)); }
        }
        """);
    var constructors = result.types.get(0).methods.stream().filter(m -> m.name.equals("Uses")).toList();
    var delegated = constructors.get(0);
    assertTrue(delegated.calls.contains("demo.Uses#<init>(java.lang.String)"));
    assertEquals("text", delegated.orderedSteps.get(0).call.methodName);
    assertEquals("constructor-call", delegated.orderedSteps.get(1).kind);
    assertEquals("demo.Uses#<init>(java.lang.String)", delegated.orderedSteps.get(1).call.resolvedMethodId);
    var parent = constructors.get(1);
    assertEquals(List.of("java.lang.RuntimeException#<init>(java.lang.String)"), parent.calls);
    assertEquals("constructor-call", parent.orderedSteps.get(0).kind);
    assertEquals("super(message)", parent.orderedSteps.get(0).snippet);
    var raw = result.methodCalls.stream().filter(c -> "super-constructor".equals(c.invocationKind) && c.location.line == 6)
        .findFirst().orElseThrow();
    assertEquals(raw.location.column, parent.orderedSteps.get(0).lineRange.startColumn);
    assertEquals(raw.location.endColumn, parent.orderedSteps.get(0).lineRange.endColumn);
    var unresolved = constructors.get(2);
    assertTrue(unresolved.calls.contains("unresolved:constructor:super"));
    assertNull(unresolved.orderedSteps.get(unresolved.orderedSteps.size()-1).call.resolvedMethodId);
  }

  @Test
  void synchronizedStepsEvaluateLocksAndKeepNestedBranchesAndNormalContinuation() throws Exception {
    AstFileResult result = export("""
        package demo;
        class Uses {
          Object lock() { return this; }
          void work() {}
          int run(boolean ready) {
            synchronized(lock()) {
              if (ready) return 1;
              synchronized(this) { work(); }
            }
            work();
            return 2;
          }
          void fail(boolean broken) {
            synchronized(this) { if (broken) throw new IllegalStateException(); }
            work();
          }
        }
        """);
    var method = result.types.get(0).methods.stream().filter(m -> m.name.equals("run")).findFirst().orElseThrow();
    var steps = method.orderedSteps;
    assertEquals("lock", steps.get(0).call.methodName);
    assertEquals("synchronized", steps.get(1).kind);
    assertEquals(2, steps.stream().filter(s -> s.kind.equals("synchronized")).count());
    var nested = steps.stream().filter(s -> s.call != null && s.call.methodName.equals("work") && s.lineRange.startLine == 8)
        .findFirst().orElseThrow();
    assertEquals(2, nested.branchPath.stream().filter(p -> p.startsWith("synchronized:")).count());
    assertTrue(nested.branchPath.stream().anyMatch(p -> p.startsWith("normal-completion:")));
    var returned = steps.stream().filter(s -> s.kind.equals("return") && s.lineRange.startLine == 7).findFirst().orElseThrow();
    assertTrue(returned.branchPath.contains("if:true"));
    var after = steps.stream().filter(s -> s.call != null && s.call.methodName.equals("work") && s.lineRange.startLine == 10)
        .findFirst().orElseThrow();
    assertTrue(after.branchPath.stream().anyMatch(p -> p.startsWith("normal-completion:6:")));
    assertFalse(after.branchPath.stream().anyMatch(p -> p.startsWith("synchronized:")));
    assertEquals(3, result.methodCalls.stream().filter(c -> c.callerMethodId.equals("demo.Uses#run(boolean)")).count());
    var fail = result.types.get(0).methods.stream().filter(m -> m.name.equals("fail")).findFirst().orElseThrow();
    var afterThrow = fail.orderedSteps.stream().filter(s -> s.call != null && s.call.methodName.equals("work")).findFirst().orElseThrow();
    assertTrue(afterThrow.branchPath.stream().anyMatch(p -> p.startsWith("normal-completion:")));
  }

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
            Object list = java.util.Collections.emptyList();
            Object format = java.text.NumberFormat.getNumberInstance();
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
    assertEquals(1, result.referenceDiagnostics.size());
  }
}
