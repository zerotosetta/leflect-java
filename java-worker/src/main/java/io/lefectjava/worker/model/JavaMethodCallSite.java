package io.lefectjava.worker.model;

import java.util.List;

public class JavaMethodCallSite {
  public String callerMethodId;
  public String callerClassId;
  public String target;
  public String targetText;
  public String targetClassId;
  public String resolvedClassId;
  public String targetMethodId;
  public String resolvedMethodId;
  public String targetMethodName;
  public String classPath;
  public List<String> parameterTypes;
  public List<String> argumentExpressions;
  public String responseType;
  public String snippet;
  public SourceLocation location;
  public LineRange lineRange;

  public JavaMethodCallSite() {
  }

  public JavaMethodCallSite(
      String callerMethodId,
      String callerClassId,
      String target,
      String targetText,
      String targetClassId,
      String resolvedClassId,
      String targetMethodId,
      String resolvedMethodId,
      String targetMethodName,
      String classPath,
      List<String> parameterTypes,
      List<String> argumentExpressions,
      String responseType,
      String snippet,
      SourceLocation location,
      LineRange lineRange
  ) {
    this.callerMethodId = callerMethodId;
    this.callerClassId = callerClassId;
    this.target = target;
    this.targetText = targetText;
    this.targetClassId = targetClassId;
    this.resolvedClassId = resolvedClassId;
    this.targetMethodId = targetMethodId;
    this.resolvedMethodId = resolvedMethodId;
    this.targetMethodName = targetMethodName;
    this.classPath = classPath;
    this.parameterTypes = parameterTypes;
    this.argumentExpressions = argumentExpressions;
    this.responseType = responseType;
    this.snippet = snippet;
    this.location = location;
    this.lineRange = lineRange;
  }
}
