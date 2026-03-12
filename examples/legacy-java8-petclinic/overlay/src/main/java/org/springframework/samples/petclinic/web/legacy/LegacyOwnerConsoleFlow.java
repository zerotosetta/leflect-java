package org.springframework.samples.petclinic.web.legacy;

public class LegacyOwnerConsoleFlow {
  public String openConsole(String lastName) {
    return new LegacyOwnerSnapshotService().buildSnapshot(lastName);
  }
}
