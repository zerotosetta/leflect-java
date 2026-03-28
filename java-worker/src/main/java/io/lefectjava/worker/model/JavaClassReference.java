package io.lefectjava.worker.model;

public class JavaClassReference {
  public String symbol;
  public String name;
  public String qualifiedName;
  public String resolvedClassId;
  public String kind;
  public String snippet;
  public SourceLocation location;
  public LineRange lineRange;

  public JavaClassReference() {
  }

  public JavaClassReference(
      String symbol,
      String name,
      String qualifiedName,
      String resolvedClassId,
      String kind,
      String snippet,
      SourceLocation location,
      LineRange lineRange
  ) {
    this.symbol = symbol;
    this.name = name;
    this.qualifiedName = qualifiedName;
    this.resolvedClassId = resolvedClassId;
    this.kind = kind;
    this.snippet = snippet;
    this.location = location;
    this.lineRange = lineRange;
  }
}
