package io.lefectjava.worker.parser;

import io.lefectjava.worker.model.AstFileResult;
import io.lefectjava.worker.model.JavaMethodCallSite;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class JavaCallExpressionTypeTest {
  @TempDir Path root;

  private AstFileResult parse(String source) throws Exception {
    Path file = root.resolve("Example.java");
    Files.writeString(file, source);
    return new JavaSummaryExtractor().extract("Example.java",
        ParserFactory.createJavaParser(root, List.of(file), List.of()).parse(file).getResult().orElseThrow(), "java");
  }

  @Test void preservesDeclarationAndLegacyWhileSpecializingReceiverAndMethodGenerics() throws Exception {
    AstFileResult result = parse("""
      import java.util.*;
      class Example {
        Map<String,Integer> values = new HashMap<>();
        Integer get() { return values.get("x"); }
        Map<String,Integer> copy() { return Collections.unmodifiableMap(values); }
        void clear() { values.clear(); }
      }
      """);
    JavaMethodCallSite get = result.methodCalls.stream().filter(c -> "get".equals(c.targetMethodName)).findFirst().orElseThrow();
    assertEquals("V", get.responseType);
    assertEquals("V", get.declaredReturnType);
    assertEquals("java.lang.Integer", get.expressionType);
    assertEquals("resolved", get.expressionTypeStatus);
    JavaMethodCallSite copy = result.methodCalls.stream().filter(c -> "unmodifiableMap".equals(c.targetMethodName)).findFirst().orElseThrow();
    assertTrue(copy.declaredReturnType.contains("K"));
    assertEquals("java.util.Map<java.lang.String, java.lang.Integer>", copy.expressionType);
    assertEquals("resolved", copy.expressionTypeStatus);
    JavaMethodCallSite clear = result.methodCalls.stream().filter(c -> "clear".equals(c.targetMethodName)).findFirst().orElseThrow();
    assertEquals("void", clear.expressionType);
    assertEquals("resolved", clear.expressionTypeStatus);
  }

  @Test void distinguishesDelegationUnknownAndUnboundTypes() throws Exception {
    AstFileResult result = parse("""
      class Example<T> {
        Example() { super(); }
        T identity(T t) { return t; }
        T use(T t) { return identity(t); }
        void unknown() { missing.noSuchMethod(); }
      }
      """);
    JavaMethodCallSite constructor = result.methodCalls.stream().filter(c -> c.invocationKind != null).findFirst().orElseThrow();
    assertEquals("not-applicable", constructor.expressionTypeStatus);
    assertNull(constructor.expressionType);
    JavaMethodCallSite unknown = result.methodCalls.stream().filter(c -> "noSuchMethod".equals(c.targetMethodName)).findFirst().orElseThrow();
    assertEquals("unresolved", unknown.expressionTypeStatus);
    assertNull(unknown.expressionType);
    JavaMethodCallSite generic = result.methodCalls.stream().filter(c -> "identity".equals(c.targetMethodName)).findFirst().orElseThrow();
    assertEquals("partial", generic.expressionTypeStatus);
    assertEquals("T", generic.expressionType);
  }

  @Test void recordsActualStaticImportDeclarationsWithoutReclassifyingOwnMethods() throws Exception {
    AstFileResult result = parse("""
      import static java.util.Objects.requireNonNull;
      import static java.util.Collections.*;
      class Example {
        void own() {}
        Object run(Object x) { own(); emptyList(); return requireNonNull(x); }
      }
      """);
    for (String name : List.of("emptyList", "requireNonNull")) {
      JavaMethodCallSite call = result.methodCalls.stream().filter(c -> name.equals(c.targetMethodName)).findFirst().orElseThrow();
      assertEquals("static-import", call.receiverOriginKind);
      assertEquals(name, call.receiverTypeSpelling);
      assertEquals("Example.java", call.receiverDeclarationFile);
      assertNotNull(call.receiverDeclarationLocation);
    }
    assertEquals("local", result.methodCalls.stream().filter(c -> "own".equals(c.targetMethodName)).findFirst().orElseThrow().receiverOriginKind);
  }
}
