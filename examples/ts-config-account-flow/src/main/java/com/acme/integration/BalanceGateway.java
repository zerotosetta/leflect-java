package com.acme.integration;

public class BalanceGateway {
  public String fetch(String queryId, String accountId) {
    return queryId + ":" + accountId;
  }

  public void sendInterface(String interfaceId) {
    if (interfaceId == null || interfaceId.isBlank()) {
      throw new IllegalArgumentException("interfaceId");
    }
  }
}
