export function run(argv: string[]): void {
  const args = new Set(argv);

  if (args.has("--version") || args.has("-v")) {
    console.log("0.1.0");
    return;
  }

  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  console.log("LeflectJava CLI scaffold");
  console.log("Run with --help to see available options.");
}

function printHelp(): void {
  console.log("LeflectJava CLI (scaffold)");
  console.log("\nUsage:\n  leflect [command] [options]\n");
  console.log("Options:");
  console.log("  -h, --help       Show help");
  console.log("  -v, --version    Show version");
}

if (require.main === module) {
  run(process.argv.slice(2));
}
