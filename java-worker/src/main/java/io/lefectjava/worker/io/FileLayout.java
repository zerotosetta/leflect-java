package io.lefectjava.worker.io;

import java.nio.file.Path;

public class FileLayout {
  private FileLayout() {
  }

  public static Path resolveAstPath(Path outputDir, Path root, Path source) {
    Path relative = root.relativize(source);
    String filename = relative.toString() + ".json";
    return outputDir.resolve(filename);
  }

  public static Path resolveJspAstPath(Path outputDir, Path root, Path source) {
    Path relative = root.relativize(source);
    String filename = relative.toString() + ".json";
    return outputDir.resolve(filename);
  }
}
