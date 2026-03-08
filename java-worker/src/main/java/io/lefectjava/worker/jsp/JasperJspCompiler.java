package io.lefectjava.worker.jsp;

import org.apache.jasper.JspC;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.stream.Collectors;

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

    JspC jspc = new JspC();
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
      throw new JspCompilationFailure(
          "Jasper failed for " + relativeJsp,
          ex,
          diagnosticLog.toString().trim()
      );
    } finally {
      logger.removeHandler(handler);
      handler.close();
    }

    List<Path> generatedFiles = listJavaFiles(outputDir);
    if (generatedFiles.isEmpty()) {
      throw new IOException("Jasper did not generate servlet java for " + relativeJsp);
    }

    return generatedFiles.get(0);
  }

  private List<Path> listJavaFiles(Path dir) throws IOException {
    try (var stream = Files.walk(dir)) {
      return stream
          .filter(path -> Files.isRegularFile(path) && path.toString().endsWith(".java"))
          .sorted(Comparator.naturalOrder())
          .collect(Collectors.toList());
    }
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
