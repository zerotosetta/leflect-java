package io.lefectjava.worker.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.lefectjava.worker.io.FileLayout;
import io.lefectjava.worker.manifest.InputManifest;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

      ObjectMapper mapper = new ObjectMapper();
      mapper.enable(SerializationFeature.INDENT_OUTPUT);

      try (BufferedWriter summaryWriter = Files.newBufferedWriter(summaryPath)) {
        for (String file : safeList(manifest.files)) {
          Path source = resolveSource(root, file);
          Path astPath = FileLayout.resolveAstPath(outputDir, root, source);
          if (astPath.getParent() != null) {
            Files.createDirectories(astPath.getParent());
          }

          String relativePath = root.relativize(source).toString().replace("\\", "/");

          Map<String, Object> payload = new HashMap<>();
          payload.put("path", relativePath);
          payload.put("status", "stub");

          mapper.writeValue(astPath.toFile(), payload);

          Map<String, Object> summary = new HashMap<>();
          summary.put("path", relativePath);
          summary.put("classCount", 0);
          summary.put("methodCount", 0);
          summaryWriter.write(mapper.writeValueAsString(summary));
          summaryWriter.newLine();
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
