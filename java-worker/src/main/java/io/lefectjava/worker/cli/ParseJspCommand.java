package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.lefectjava.worker.io.FileLayout;
import io.lefectjava.worker.io.JsonWriters;
import io.lefectjava.worker.jsp.JasperJspCompiler;
import io.lefectjava.worker.manifest.JspInputManifest;
import io.lefectjava.worker.parser.JavaAstExporter;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ParseJspCommand {
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

      ObjectMapper mapper = JsonWriters.createMapper();
      JasperJspCompiler compiler = new JasperJspCompiler();
      JavaAstExporter exporter = new JavaAstExporter();

      for (String file : safeList(manifest.files)) {
        Path source = resolveSource(root, file);
        String relativeJspPath = root.relativize(source).toString().replace("\\", "/");

        try {
          Path generatedServlet = compiler.compile(webappRoot, source, servletOutputDir);
          String relativeServletPath = servletOutputDir
              .relativize(generatedServlet)
              .toString()
              .replace("\\", "/");

          JavaAstExporter.ExportResult result = exporter.export(
              generatedServlet,
              relativeServletPath,
              "jsp-servlet"
          );

          Path astPath = FileLayout.resolveJspAstPath(astOutputDir, root, source);
          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("jspPath", relativeJspPath);
          payload.put("generatedServletPath", relativeServletPath);
          payload.put("ast", result.ast);

          JsonWriters.writeJson(mapper, astPath, payload);

          for (var problem : result.problems) {
            Files.writeString(
                errorLog,
                mapper.writeValueAsString(problem) + System.lineSeparator(),
                StandardOpenOption.APPEND
            );
          }
        } catch (Exception ex) {
          Files.writeString(
              errorLog,
              mapper.writeValueAsString(Map.of(
                  "path", relativeJspPath,
                  "message", ex.getMessage()
              )) + System.lineSeparator(),
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
}
