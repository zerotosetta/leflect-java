package io.lefectjava.worker.cli;

public class CommandRouter {
  public int run(String[] args) {
    if (args == null || args.length == 0) {
      printUsage();
      return 1;
    }

    String command = args[0];
    if ("parse-java".equals(command)) {
      String manifestPath = parseManifestPath(args);
      if (manifestPath == null || manifestPath.isEmpty()) {
        System.err.println("Missing --manifest <path>");
        return 1;
      }
      WorkerOptions options = new WorkerOptions(manifestPath);
      return new ParseJavaCommand().run(options);
    }
    if ("parse-jsp".equals(command)) {
      String manifestPath = parseManifestPath(args);
      if (manifestPath == null || manifestPath.isEmpty()) {
        System.err.println("Missing --manifest <path>");
        return 1;
      }
      WorkerOptions options = new WorkerOptions(manifestPath);
      return new ParseJspCommand().run(options);
    }

    System.err.println("Unknown command: " + command);
    printUsage();
    return 1;
  }

  private String parseManifestPath(String[] args) {
    for (int i = 0; i < args.length - 1; i++) {
      if ("--manifest".equals(args[i])) {
        return args[i + 1];
      }
    }
    return null;
  }

  private void printUsage() {
    System.out.println("LeflectJava Java Worker");
    System.out.println("Usage: parse-java|parse-jsp --manifest <path>");
  }
}
