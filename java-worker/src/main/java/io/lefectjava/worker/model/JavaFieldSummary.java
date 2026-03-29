package io.lefectjava.worker.model;

import java.util.List;

public class JavaFieldSummary {
  public String id;
  public String name;
  public String declaredType;
  public String type;
  public List<String> modifiers;
  public String lifetime;
  public String initializerSnippet;
  public SourceLocation location;
  public LineRange lineRange;

  public JavaFieldSummary() {
  }

  public JavaFieldSummary(
      String id,
      String name,
      String declaredType,
      String type,
      List<String> modifiers,
      String lifetime,
      String initializerSnippet,
      SourceLocation location,
      LineRange lineRange
  ) {
    this.id = id;
    this.name = name;
    this.declaredType = declaredType;
    this.type = type;
    this.modifiers = modifiers;
    this.lifetime = lifetime;
    this.initializerSnippet = initializerSnippet;
    this.location = location;
    this.lineRange = lineRange;
  }
}
