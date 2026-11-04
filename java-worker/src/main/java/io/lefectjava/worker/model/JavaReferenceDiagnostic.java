package io.lefectjava.worker.model;

public class JavaReferenceDiagnostic {
  public String snippet;
  public String message;
  public SourceLocation location;

  public JavaReferenceDiagnostic(String snippet, String message, SourceLocation location) {
    this.snippet = snippet;
    this.message = message;
    this.location = location;
  }
}
