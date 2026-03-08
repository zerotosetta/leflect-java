package io.lefectjava.worker.model;

public class JavaClassReference {
  public String symbol;
  public String qualifiedName;
  public String kind;
  public String snippet;
  public SourceLocation location;

  public JavaClassReference() {
  }

  public JavaClassReference(
      String symbol,
      String qualifiedName,
      String kind,
      String snippet,
      SourceLocation location
  ) {
    this.symbol = symbol;
    this.qualifiedName = qualifiedName;
    this.kind = kind;
    this.snippet = snippet;
    this.location = location;
  }
}
