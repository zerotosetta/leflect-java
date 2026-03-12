package com.acme.account;

public class AccountController {
  private final AccountService service = new AccountService();

  public String loadAccount(String accountId) {
    return service.loadBalance(accountId);
  }
}
