package io.lefectjava.worker.model;

import java.util.List;

public class AstFileResult {
  public String path;
  public String sourceKind;
  public String packageName;
  public List<String> imports;
  public List<JavaClassSummary> types;

  public AstFileResult() {
  }

  public AstFileResult(
      String path,
      String sourceKind,
      String packageName,
      List<String> imports,
      List<JavaClassSummary> types
  ) {
    this.path = path;
    this.sourceKind = sourceKind;
    this.packageName = packageName;
    this.imports = imports;
    this.types = types;
  }
}
