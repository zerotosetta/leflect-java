package com.acme.account;

import com.acme.integration.BalanceGateway;

public class AccountService {
  private final BalanceGateway gateway = new BalanceGateway();

  public String loadBalance(String accountId) {
    String queryId = "account.selectBalance";
    gateway.sendInterface("IF_ACCOUNT_BALANCE");
    return gateway.fetch(queryId, accountId);
  }
}
