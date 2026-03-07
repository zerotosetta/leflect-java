package io.lefectjava.worker.cli;

public class WorkerOptions {
  private final String manifestPath;

  public WorkerOptions(String manifestPath) {
    this.manifestPath = manifestPath;
  }

  public String getManifestPath() {
    return manifestPath;
  }
}
