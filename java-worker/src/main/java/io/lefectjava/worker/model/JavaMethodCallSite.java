package io.lefectjava.worker.model;

public class JavaMethodCallSite {
  public String callerMethodId;
  public String callerClassId;
  public String target;
  public String targetClassId;
  public String targetMethodId;
  public String snippet;
  public SourceLocation location;

  public JavaMethodCallSite() {
  }

  public JavaMethodCallSite(
      String callerMethodId,
      String callerClassId,
      String target,
      String targetClassId,
      String targetMethodId,
      String snippet,
      SourceLocation location
  ) {
    this.callerMethodId = callerMethodId;
    this.callerClassId = callerClassId;
    this.target = target;
    this.targetClassId = targetClassId;
    this.targetMethodId = targetMethodId;
    this.snippet = snippet;
    this.location = location;
  }
}
