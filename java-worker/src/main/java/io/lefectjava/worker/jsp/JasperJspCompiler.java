package io.lefectjava.worker.jsp;

import org.apache.jasper.Constants;
import org.apache.jasper.JspC;
import org.apache.jasper.compiler.JspUtil;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

public class JasperJspCompiler {
  public Path compile(
      Path webappRoot,
      Path jspSource,
      Path servletOutputRoot,
      List<String> classpathEntries
  ) throws Exception {
    Path absoluteJsp = jspSource.isAbsolute() ? jspSource : webappRoot.resolve(jspSource);
    Path relativeJsp = webappRoot.relativize(absoluteJsp);
    Path outputDir = servletOutputRoot.resolve(sanitize(relativeJsp.toString()));
    Files.createDirectories(outputDir);
    Path generatedServlet = resolveGeneratedServlet(outputDir, relativeJsp);
    // The caller already selected the JSP for recompilation, including changes to static fragments.
    Files.deleteIfExists(generatedServlet);

    JspC jspc = new JspC();
    // Compile one page per invocation and retain its original Jasper error.
    jspc.setArgs(new String[] {"-failFast"});
    jspc.setUriroot(webappRoot.toString());
    jspc.setOutputDir(outputDir.toString());
    jspc.setCompile(false);
    jspc.setJspFiles(relativeJsp.toString().replace("\\", "/"));
    if (classpathEntries != null && !classpathEntries.isEmpty()) {
      jspc.setClassPath(String.join(File.pathSeparator, classpathEntries));
    }
    StringBuilder diagnosticLog = new StringBuilder();
    Handler handler = createDiagnosticHandler(diagnosticLog);
    Logger logger = Logger.getLogger("org.apache.jasper");
    logger.addHandler(handler);

    try {
      jspc.execute();
    } catch (Exception ex) {
      StringWriter stack = new StringWriter();
      ex.printStackTrace(new PrintWriter(stack));
      diagnosticLog.append(System.lineSeparator()).append(stack);
      throw new JspCompilationFailure(
          "Jasper failed for " + relativeJsp,
          ex,
          diagnosticLog.toString().trim()
      );
    } finally {
      logger.removeHandler(handler);
      handler.close();
    }

    if (!Files.isRegularFile(generatedServlet)) {
      throw new IOException("Jasper did not generate servlet java for " + relativeJsp);
    }

    return generatedServlet;
  }

  private Path resolveGeneratedServlet(Path outputDir, Path relativeJsp) {
    Path packageDir = outputDir.resolve(Constants.JSP_PACKAGE_NAME.replace('.', '/'));
    Path jspDirectory = relativeJsp.getParent();
    if (jspDirectory != null) {
      String jspPackage = JspUtil.makeJavaPackage(jspDirectory.toString().replace('\\', '/'));
      packageDir = packageDir.resolve(jspPackage.replace('.', '/'));
    }
    return packageDir.resolve(JspUtil.makeJavaIdentifier(relativeJsp.getFileName().toString()) + ".java");
  }

  private String sanitize(String value) {
    return value.replace("\\", "_").replace("/", "_").replace(".", "_");
  }

  private Handler createDiagnosticHandler(StringBuilder buffer) {
    Handler handler = new Handler() {
      @Override
      public void publish(LogRecord record) {
        if (!isLoggable(record)) {
          return;
        }

        if (buffer.length() > 0) {
          buffer.append(System.lineSeparator());
        }
        buffer.append(record.getLevel().getName()).append(": ").append(record.getMessage());

        if (record.getThrown() != null) {
          StringWriter writer = new StringWriter();
          record.getThrown().printStackTrace(new PrintWriter(writer));
          buffer.append(System.lineSeparator()).append(writer);
        }
      }

      @Override
      public void flush() {
      }

      @Override
      public void close() {
      }
    };
    handler.setLevel(Level.ALL);
    return handler;
  }

  public static class JspCompilationFailure extends Exception {
    private final String diagnostics;

    public JspCompilationFailure(String message, Throwable cause, String diagnostics) {
      super(message, cause);
      this.diagnostics = diagnostics;
    }

    public String getDiagnostics() {
      return diagnostics;
    }
  }
}
