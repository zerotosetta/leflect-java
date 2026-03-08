package io.lefectjava.worker.model;

public class ParseProblemRecord {
  public String stage;
  public String severity;
  public String path;
  public String category;
  public String summary;
  public String message;
  public String detail;
  public String hint;
  public String relatedUri;
  public String symbol;
  public String generatedPath;
  public String snippet;
  public String rawCause;
  public SourceLocation location;

  public ParseProblemRecord() {
  }

  public ParseProblemRecord(
      String stage,
      String severity,
      String path,
      String category,
      String summary,
      String message
  ) {
    this.stage = stage;
    this.severity = severity;
    this.path = path;
    this.category = category;
    this.summary = summary;
    this.message = message;
  }
}
