package io.lefectjava.worker;

import io.lefectjava.worker.cli.CommandRouter;

public class Main {
  public static void main(String[] args) {
    CommandRouter router = new CommandRouter();
    int code = router.run(args);
    if (code != 0) {
      System.exit(code);
    }
  }
}
