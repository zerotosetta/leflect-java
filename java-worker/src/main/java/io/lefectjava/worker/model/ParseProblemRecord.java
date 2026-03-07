package io.lefectjava.worker.model;

public class ParseProblemRecord {
  public String path;
  public String message;

  public ParseProblemRecord() {
  }

  public ParseProblemRecord(String path, String message) {
    this.path = path;
    this.message = message;
  }
}
