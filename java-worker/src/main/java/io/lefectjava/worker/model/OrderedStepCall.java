package io.lefectjava.worker.model;

public class OrderedStepCall {
  public String targetText;
  public String resolvedMethodId;
  public String resolvedClassId;
  public String methodName;

  public OrderedStepCall() {
  }

  public OrderedStepCall(
      String targetText,
      String resolvedMethodId,
      String resolvedClassId,
      String methodName
  ) {
    this.targetText = targetText;
    this.resolvedMethodId = resolvedMethodId;
    this.resolvedClassId = resolvedClassId;
    this.methodName = methodName;
  }
}
