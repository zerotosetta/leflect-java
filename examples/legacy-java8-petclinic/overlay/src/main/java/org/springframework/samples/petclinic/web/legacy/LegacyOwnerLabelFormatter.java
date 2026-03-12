package org.springframework.samples.petclinic.web.legacy;

public class LegacyOwnerLabelFormatter {
  public String format(String lastName, int ownerCount) {
    return "legacy-owner-console:" + lastName + ":" + ownerCount;
  }
}
