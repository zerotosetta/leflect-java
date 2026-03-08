package io.lefectjava.worker.model;

import java.util.List;

public class JavaMethodCallSite {
  public String callerMethodId;
  public String callerClassId;
  public String target;
  public String targetClassId;
  public String targetMethodId;
  public String targetMethodName;
  public String classPath;
  public List<String> parameterTypes;
  public List<String> argumentExpressions;
  public String responseType;
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
      String targetMethodName,
      String classPath,
      List<String> parameterTypes,
      List<String> argumentExpressions,
      String responseType,
      String snippet,
      SourceLocation location
  ) {
    this.callerMethodId = callerMethodId;
    this.callerClassId = callerClassId;
    this.target = target;
    this.targetClassId = targetClassId;
    this.targetMethodId = targetMethodId;
    this.targetMethodName = targetMethodName;
    this.classPath = classPath;
    this.parameterTypes = parameterTypes;
    this.argumentExpressions = argumentExpressions;
    this.responseType = responseType;
    this.snippet = snippet;
    this.location = location;
  }
}
