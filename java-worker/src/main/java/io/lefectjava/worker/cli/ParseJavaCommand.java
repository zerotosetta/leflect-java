package io.lefectjava.worker.cli;

import io.lefectjava.worker.io.FileLayout;
import io.lefectjava.worker.io.JsonWriters;
import io.lefectjava.worker.manifest.InputManifest;
import io.lefectjava.worker.parser.JavaAstExporter;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

public class ParseJavaCommand {
  public int run(WorkerOptions options) {
    try {
      InputManifest manifest = InputManifest.fromFile(Paths.get(options.getManifestPath()));
      Path root = Paths.get(manifest.root).toAbsolutePath().normalize();
      Path outputDir = Paths.get(manifest.outputDir).toAbsolutePath().normalize();
      Path errorLog = Paths.get(manifest.errorLog).toAbsolutePath().normalize();

      Files.createDirectories(outputDir);
      if (errorLog.getParent() != null) {
        Files.createDirectories(errorLog.getParent());
      }
      Files.writeString(errorLog, "");

      Path analysisRoot = outputDir.getParent();
      Path indexDir = analysisRoot != null ? analysisRoot.resolve("index") : outputDir.resolveSibling("index");
      Files.createDirectories(indexDir);
      Path summaryPath = indexDir.resolve("java-summary.jsonl");

      JavaAstExporter exporter = new JavaAstExporter();

      try (BufferedWriter summaryWriter = Files.newBufferedWriter(summaryPath)) {
        for (String file : safeList(manifest.files)) {
          Path source = resolveSource(root, file);
          Path astPath = FileLayout.resolveAstPath(outputDir, root, source);
          String relativePath = root.relativize(source).toString().replace("\\", "/");
          JavaAstExporter.ExportResult result = exporter.export(source, relativePath, "java");

          if (astPath.getParent() != null) {
            Files.createDirectories(astPath.getParent());
          }
          Files.writeString(astPath, result.rawAstJson);
          for (var problem : result.problems) {
            Files.writeString(
                errorLog,
                JsonWriters.toJsonLine(problem) + System.lineSeparator(),
                java.nio.file.StandardOpenOption.APPEND
            );
          }

          JsonWriters.appendJsonLine(summaryWriter, result.ast);
        }
      }

      return 0;
    } catch (IOException ex) {
      System.err.println("Failed to parse manifest: " + ex.getMessage());
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
