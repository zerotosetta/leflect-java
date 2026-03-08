package io.lefectjava.worker.model;

import java.util.List;

public class AstFileResult {
  public String path;
  public String sourceKind;
  public String packageName;
  public List<String> imports;
  public List<JavaClassSummary> types;
  public List<JavaClassReference> classReferences;
  public List<JavaMethodCallSite> methodCalls;

  public AstFileResult() {
  }

  public AstFileResult(
      String path,
      String sourceKind,
      String packageName,
      List<String> imports,
      List<JavaClassSummary> types,
      List<JavaClassReference> classReferences,
      List<JavaMethodCallSite> methodCalls
  ) {
    this.path = path;
    this.sourceKind = sourceKind;
    this.packageName = packageName;
    this.imports = imports;
    this.types = types;
    this.classReferences = classReferences;
    this.methodCalls = methodCalls;
  }
}
