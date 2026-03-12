package org.springframework.samples.petclinic.web.legacy;

public class LegacyOwnerConsoleAdapter {
  public String loadOwnerConsole(String lastName) {
    return new LegacyOwnerConsoleFlow().openConsole(lastName);
  }
}
