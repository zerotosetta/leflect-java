package org.springframework.samples.petclinic.web.legacy;

import java.util.List;

import org.springframework.samples.petclinic.model.Owner;

public class LegacyOwnerCardAssembler {
  public String assemble(String lastName, List<Owner> owners) {
    return new LegacyOwnerAuditTrail().record(lastName, owners.size());
  }
}
