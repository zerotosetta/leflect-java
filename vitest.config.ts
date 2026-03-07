import path from "path";
import { defineConfig } from "vitest/config";

const packages = [
  "cli",
  "core",
  "scanner",
  "parser-jsp",
  "parser-tld",
  "java-bridge",
  "indexer",
  "graph",
  "labeler",
  "reporter",
  "schema",
  "testkit"
];

export default defineConfig({
  resolve: {
    alias: packages.map((name) => ({
      find: `@lefectjava/${name}`,
      replacement: path.resolve(__dirname, "packages", name, "src")
    }))
  },
  test: {
    include: ["packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false
  }
});
