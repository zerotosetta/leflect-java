package io.lefectjava.worker.model;

import java.util.List;

public class JavaMethodSummary {
  public String id;
  public String name;
  public String returnType;
  public List<String> parameters;
  public List<String> calls;
  public SourceLocation location;

  public JavaMethodSummary() {
  }

  public JavaMethodSummary(
      String id,
      String name,
      String returnType,
      List<String> parameters,
      List<String> calls,
      SourceLocation location
  ) {
    this.id = id;
    this.name = name;
    this.returnType = returnType;
    this.parameters = parameters;
    this.calls = calls;
    this.location = location;
  }
}
