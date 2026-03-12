package org.springframework.samples.petclinic.web.legacy;

public class LegacyOwnerAuditTrail {
  public String record(String lastName, int ownerCount) {
    return new LegacyOwnerLabelFormatter().format(lastName, ownerCount);
  }
}
