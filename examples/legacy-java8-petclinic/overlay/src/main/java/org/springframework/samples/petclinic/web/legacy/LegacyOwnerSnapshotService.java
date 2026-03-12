package org.springframework.samples.petclinic.web.legacy;

public class LegacyOwnerSnapshotService {
  public String buildSnapshot(String lastName) {
    return new LegacyOwnerSearchBridge().fetchOwnerLabel(lastName);
  }
}
