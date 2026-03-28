package io.lefectjava.worker.model;

import java.util.List;

public class JavaMethodSummary {
  public String id;
  public String name;
  public String returnType;
  public List<String> parameters;
  public List<String> calls;
  public SourceLocation location;
  public LineRange lineRange;
  public List<OrderedExecutionStep> orderedSteps;

  public JavaMethodSummary() {
  }

  public JavaMethodSummary(
      String id,
      String name,
      String returnType,
      List<String> parameters,
      List<String> calls,
      SourceLocation location,
      LineRange lineRange,
      List<OrderedExecutionStep> orderedSteps
  ) {
    this.id = id;
    this.name = name;
    this.returnType = returnType;
    this.parameters = parameters;
    this.calls = calls;
    this.location = location;
    this.lineRange = lineRange;
    this.orderedSteps = orderedSteps;
  }
}
