package io.lefectjava.worker.jsp;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JasperJspCompilerTest {
  @Test
  void recompilesPageServletWhenNestedFragmentChanges(@TempDir Path root) throws Exception {
    Path webapp = root.resolve("webapp");
    Path page = webapp.resolve("views/home.jsp");
    Path body = webapp.resolve("views/body.jspf");
    Path value = webapp.resolve("views/value.jspf");
    Path tag = webapp.resolve("WEB-INF/tags/card.tag");
    Files.createDirectories(page.getParent());
    Files.createDirectories(tag.getParent());
    Files.writeString(page, """
        <%@ taglib prefix="app" tagdir="/WEB-INF/tags" %>
        <%@ include file="body.jspf" %>
        <app:card />
        """);
    Files.writeString(body, "<%@ include file=\"value.jspf\" %>");
    Files.writeString(value, "INITIAL_SENTINEL");
    Files.writeString(tag, "Card");

    JasperJspCompiler compiler = new JasperJspCompiler();
    Path output = root.resolve("generated");
    Path servlet = compiler.compile(webapp, page, output, List.of());
    assertEquals("home_jsp.java", servlet.getFileName().toString());
    assertTrue(Files.readString(servlet).contains("INITIAL_SENTINEL"));

    Files.writeString(value, "UPDATED_SENTINEL");
    Path updatedServlet = compiler.compile(webapp, page, output, List.of());
    assertEquals(servlet, updatedServlet);
    assertTrue(Files.readString(updatedServlet).contains("UPDATED_SENTINEL"));
  }
}
