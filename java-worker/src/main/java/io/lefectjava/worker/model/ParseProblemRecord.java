package io.lefectjava.worker.model;

import java.util.List;

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
  public String exceptionClass;
  public String rootCauseClass;
  public String rootCauseMessage;
  public String stackTrace;
  public String workerDiagnostics;
  public List<String> causeChain;
  public List<String> missingClasses;
  public List<String> missingPaths;
  public List<String> unresolvedTaglibUris;
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
