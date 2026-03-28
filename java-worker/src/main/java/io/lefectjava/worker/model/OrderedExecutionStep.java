package io.lefectjava.worker.model;

import java.util.List;

public class OrderedExecutionStep {
  public String id;
  public String kind;
  public String snippet;
  public List<String> branchPath;
  public LineRange lineRange;
  public OrderedStepCall call;

  public OrderedExecutionStep() {
  }

  public OrderedExecutionStep(
      String id,
      String kind,
      String snippet,
      List<String> branchPath,
      LineRange lineRange,
      OrderedStepCall call
  ) {
    this.id = id;
    this.kind = kind;
    this.snippet = snippet;
    this.branchPath = branchPath;
    this.lineRange = lineRange;
    this.call = call;
  }
}
