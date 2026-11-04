package io.lefectjava.worker.model;

public class OrderedStepField {
  public String id;
  public String classId;
  public String name;

  public OrderedStepField(String classId, String name) {
    this.id = classId + "#" + name;
    this.classId = classId;
    this.name = name;
  }
}
