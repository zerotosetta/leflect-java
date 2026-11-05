package io.lefectjava.worker.parser;

import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.expr.MethodCallExpr;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ParserFactoryIsolationTest {
  @TempDir Path root;

  @Test void projectApiWinsAndWorkerServletDoesNotLeak() throws Exception {
    Path api = root.resolve("api/javax/servlet/http/HttpServlet.java");
    Files.createDirectories(api.getParent());
    Files.writeString(api, "package javax.servlet.http; public class HttpServlet { public String projectOnly() { return null; } }");
    Path classes = root.resolve("classes");
    Files.createDirectories(classes);
    assertEquals(0, ToolProvider.getSystemJavaCompiler().run(null, null, null,
        "--release", "8", "-d", classes.toString(), api.toString()));
    CompilationUnit unit = parse("class Example extends javax.servlet.http.HttpServlet { void use() { projectOnly(); getServletName(); } }", List.of(classes.toString()));
    MethodCallExpr projectCall = call(unit, "projectOnly");
    assertEquals("javax.servlet.http.HttpServlet.projectOnly()", projectCall.resolve().getQualifiedSignature());
    assertThrows(RuntimeException.class, () -> call(unit, "getServletName").resolve());
    CompilationUnit absent = parse("class Example extends javax.servlet.http.HttpServlet { void use() { getServletName(); } }", List.of());
    assertThrows(RuntimeException.class, () -> call(absent, "getServletName").resolve());
  }

  @Test void javaSeJavaxTypesStillResolve() throws Exception {
    CompilationUnit unit = parse("class Example { void use() throws Exception { javax.crypto.Cipher.getInstance(\"AES\"); java.util.Collections.emptyList(); } }", List.of());
    assertEquals("javax.crypto.Cipher", call(unit, "getInstance").resolve().declaringType().getQualifiedName());
    assertEquals("java.util.Collections", call(unit, "emptyList").resolve().declaringType().getQualifiedName());
  }

  @Test void jspBinarySignaturesResolveWithoutLoadingAbsentOptionalElApi() throws Exception {
    Path resources = Path.of("..", "resources", "api-packs").toAbsolutePath().normalize();
    List<String> classpath = List.of(
        resources.resolve("javax.servlet-api/4.0.1/javax.servlet-api-4.0.1.jar").toString(),
        resources.resolve("javax.servlet.jsp-api/2.3.3/javax.servlet.jsp-api-2.3.3.jar").toString());
    CompilationUnit unit = parse("class Example { void use(javax.servlet.jsp.PageContext context) { context.getServletContext(); } }", classpath);
    assertEquals("getServletContext", call(unit, "getServletContext").resolve().getName());
    assertEquals("javax.servlet.ServletContext", call(unit, "getServletContext").calculateResolvedType().describe());
  }

  private CompilationUnit parse(String source, List<String> classpath) throws Exception {
    Path file = root.resolve("Example.java");
    Files.writeString(file, source);
    return ParserFactory.createJavaParser(root, List.of(file), classpath).parse(file).getResult().orElseThrow();
  }

  private MethodCallExpr call(CompilationUnit unit, String name) {
    return unit.findAll(MethodCallExpr.class).stream().filter(c -> name.equals(c.getNameAsString())).findFirst().orElseThrow();
  }
}
