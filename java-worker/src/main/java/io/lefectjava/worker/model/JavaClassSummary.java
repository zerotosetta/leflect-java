package io.lefectjava.worker.model;

import java.util.List;

public class JavaClassSummary {
  public String name;
  public String fqn;
  public String kind;
  public List<String> extendsTypes;
  public List<String> implementsTypes;
  public List<JavaFieldSummary> fields;
  public List<JavaMethodSummary> methods;
  public SourceLocation location;
  public LineRange lineRange;

  public JavaClassSummary() {
  }

  public JavaClassSummary(
      String name,
      String fqn,
      String kind,
      List<String> extendsTypes,
      List<String> implementsTypes,
      List<JavaFieldSummary> fields,
      List<JavaMethodSummary> methods,
      SourceLocation location,
      LineRange lineRange
  ) {
    this.name = name;
    this.fqn = fqn;
    this.kind = kind;
    this.extendsTypes = extendsTypes;
    this.implementsTypes = implementsTypes;
    this.fields = fields;
    this.methods = methods;
    this.location = location;
    this.lineRange = lineRange;
  }
}
