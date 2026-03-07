package io.lefectjava.worker.manifest;

public class OutputManifest {
  public String outputDir;
  public int processedFiles;
  public int errorCount;

  public OutputManifest() {
  }

  public OutputManifest(String outputDir, int processedFiles, int errorCount) {
    this.outputDir = outputDir;
    this.processedFiles = processedFiles;
    this.errorCount = errorCount;
  }
}
