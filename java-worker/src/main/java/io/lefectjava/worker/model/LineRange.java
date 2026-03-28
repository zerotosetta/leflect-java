package io.lefectjava.worker.model;

public class LineRange {
  public Integer startLine;
  public Integer startColumn;
  public Integer endLine;
  public Integer endColumn;

  public LineRange() {
  }

  public LineRange(Integer startLine, Integer startColumn, Integer endLine, Integer endColumn) {
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}
