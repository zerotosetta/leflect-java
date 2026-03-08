package io.lefectjava.worker.cli;

import io.lefectjava.worker.io.FileLayout;
import io.lefectjava.worker.io.JsonWriters;
import io.lefectjava.worker.jsp.JasperJspCompiler;
import io.lefectjava.worker.jsp.JasperJspCompiler.JspCompilationFailure;
import io.lefectjava.worker.manifest.JspInputManifest;
import io.lefectjava.worker.model.ParseProblemRecord;
import io.lefectjava.worker.model.SourceLocation;
import io.lefectjava.worker.parser.JavaAstExporter;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ParseJspCommand {
  private static final Pattern ABSOLUTE_URI_PATTERN =
      Pattern.compile("absolute uri: \\[(.+?)\\] cannot be resolved", Pattern.CASE_INSENSITIVE);

  public int run(WorkerOptions options) {
    try {
      JspInputManifest manifest = JspInputManifest.fromFile(Paths.get(options.getManifestPath()));
      Path root = Paths.get(manifest.root).toAbsolutePath().normalize();
      Path webappRoot = Paths.get(manifest.webappRoot).toAbsolutePath().normalize();
      Path servletOutputDir = Paths.get(manifest.servletOutputDir).toAbsolutePath().normalize();
      Path astOutputDir = Paths.get(manifest.astOutputDir).toAbsolutePath().normalize();
      Path errorLog = Paths.get(manifest.errorLog).toAbsolutePath().normalize();

      Files.createDirectories(servletOutputDir);
      Files.createDirectories(astOutputDir);
      if (errorLog.getParent() != null) {
        Files.createDirectories(errorLog.getParent());
      }
      Files.writeString(errorLog, "");

      JasperJspCompiler compiler = new JasperJspCompiler();
      JavaAstExporter exporter = new JavaAstExporter();

      for (String file : safeList(manifest.files)) {
        Path source = resolveSource(root, file);
        String relativeJspPath = root.relativize(source).toString().replace("\\", "/");
        String relativeServletPath = null;

        try {
          Path generatedServlet = compiler.compile(webappRoot, source, servletOutputDir);
          relativeServletPath = servletOutputDir
              .relativize(generatedServlet)
              .toString()
              .replace("\\", "/");

          JavaAstExporter.ExportResult result = exporter.export(
              generatedServlet,
              relativeServletPath,
              "jsp-servlet"
          );

          Path astPath = FileLayout.resolveJspAstPath(astOutputDir, root, source);
          if (astPath.getParent() != null) {
            Files.createDirectories(astPath.getParent());
          }
          Files.writeString(astPath, result.rawAstJson);

          for (var problem : result.problems) {
            Files.writeString(
                errorLog,
                JsonWriters.toJsonLine(problem) + System.lineSeparator(),
                StandardOpenOption.APPEND
            );
          }
        } catch (Exception ex) {
          ParseProblemRecord problem = createJspProblemRecord(source, relativeJspPath, relativeServletPath, ex);
          Files.writeString(
              errorLog,
              JsonWriters.toJsonLine(problem) + System.lineSeparator(),
              StandardOpenOption.APPEND
          );
        }
      }

      return 0;
    } catch (IOException ex) {
      System.err.println("Failed to parse JSP manifest: " + ex.getMessage());
      return 1;
    }
  }

  private static List<String> safeList(List<String> files) {
    return files == null ? List.of() : files;
  }

  private static Path resolveSource(Path root, String file) {
    Path source = Paths.get(file);
    if (!source.isAbsolute()) {
      source = root.resolve(source);
    }
    return source.normalize();
  }

  private static ParseProblemRecord createJspProblemRecord(
      Path source,
      String relativeJspPath,
      String relativeServletPath,
      Exception ex
  ) throws IOException {
    Throwable rootCause = findRootCause(ex);
    String message = firstNonBlank(rootCause.getMessage(), ex.getMessage(), rootCause.toString());

    ParseProblemRecord record = new ParseProblemRecord(
        "jsp-parse",
        "error",
        relativeJspPath,
        "jsp.compile.error",
        "JSP compilation failed",
        message
    );
    record.detail = buildDetail(ex);
    record.generatedPath = relativeServletPath;
    record.hint = "Inspect the JSP and ensure required taglib/TLD dependencies are available to Jasper.";
    record.rawCause = rootCause.toString();

    String diagnostics = ex instanceof JspCompilationFailure
        ? ((JspCompilationFailure) ex).getDiagnostics()
        : null;
    if (diagnostics != null && !diagnostics.isBlank()) {
      record.detail = diagnostics;
    }

    Matcher matcher = ABSOLUTE_URI_PATTERN.matcher(
        "%s %s %s".formatted(message, record.detail, diagnostics == null ? "" : diagnostics)
    );
    if (matcher.find()) {
      String relatedUri = matcher.group(1);
      record.category = "jsp.taglib.uri.unresolved";
      record.summary = "Taglib URI could not be resolved";
      record.relatedUri = relatedUri;
      record.hint =
          "Add the dependency JAR/TLD for this URI or declare the mapping in web.xml before running Jasper AST generation.";
      attachUriLocation(record, source, relatedUri);
    }

    return record;
  }

  private static void attachUriLocation(ParseProblemRecord record, Path source, String relatedUri)
      throws IOException {
    String[] lines = Files.readString(source).split("\\R", -1);
    for (int index = 0; index < lines.length; index += 1) {
      int columnIndex = lines[index].indexOf(relatedUri);
      if (columnIndex >= 0) {
        record.location = new SourceLocation(index + 1, columnIndex + 1, index + 1,
            columnIndex + relatedUri.length());
        record.snippet = lines[index].trim();
        return;
      }
    }
  }

  private static Throwable findRootCause(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null && current.getCause() != current) {
      current = current.getCause();
    }
    return current;
  }

  private static String buildDetail(Throwable error) {
    StringBuilder builder = new StringBuilder();
    Throwable current = error;
    while (current != null) {
      if (builder.length() > 0) {
        builder.append(" -> ");
      }
      builder.append(current.getClass().getSimpleName());
      if (current.getMessage() != null && !current.getMessage().isBlank()) {
        builder.append(": ").append(current.getMessage());
      }
      current = current.getCause();
    }
    return builder.toString();
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return "";
  }
}
