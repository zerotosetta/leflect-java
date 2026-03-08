package io.lefectjava.worker.model;

public class SourceLocation {
  public Integer line;
  public Integer column;
  public Integer endLine;
  public Integer endColumn;

  public SourceLocation() {
  }

  public SourceLocation(Integer line, Integer column, Integer endLine, Integer endColumn) {
    this.line = line;
    this.column = column;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}
