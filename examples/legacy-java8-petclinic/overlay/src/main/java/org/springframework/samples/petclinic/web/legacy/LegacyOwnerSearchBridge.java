package org.springframework.samples.petclinic.web.legacy;

import java.util.Collections;
import java.util.List;

import org.springframework.samples.petclinic.model.Owner;

public class LegacyOwnerSearchBridge {
  public String fetchOwnerLabel(String lastName) {
    List<Owner> owners = Collections.emptyList();
    return new LegacyOwnerCardAssembler().assemble(lastName, owners);
  }
}
