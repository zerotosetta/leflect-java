#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const workerDir = path.join(workspaceRoot, "java-worker");

const command = process.argv[2] ?? "build";
const extraArgs = process.argv.slice(3);
const mvn = resolveMavenCommand();

if (!mvn) {
  console.error(
    "Unable to find Maven. Set MAVEN_BIN, add 'mvn' to PATH, or place a wrapper at java-worker/mvnw."
  );
  process.exit(1);
}

const baseArgs = buildGoalArgs(command);
const args = [...baseArgs, ...extraArgs];
const result = spawnSync(mvn.command, [...mvn.args, ...args], {
  cwd: workerDir,
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

function buildGoalArgs(value) {
  switch (value) {
    case "build":
      return ["clean", "test", "package"];
    case "package":
      return ["clean", "package"];
    case "test":
      return ["test"];
    case "clean":
      return ["clean"];
    default:
      console.error("Usage: node scripts/java-worker.mjs <build|package|test|clean> [maven-args...]");
      process.exit(1);
  }
}

function resolveMavenCommand() {
  const candidates = [];

  if (process.env.MAVEN_BIN) {
    candidates.push({
      command: path.resolve(process.env.MAVEN_BIN),
      args: []
    });
  }

  const wrapper = path.join(workerDir, "mvnw");
  if (existsSync(wrapper)) {
    candidates.push({
      command: wrapper,
      args: []
    });
  }

  candidates.push({
    command: "mvn",
    args: []
  });

  const fallback = "/tmp/apache-maven-3.9.9/bin/mvn";
  if (existsSync(fallback)) {
    candidates.push({
      command: fallback,
      args: []
    });
  }

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "-version"], {
      stdio: "ignore",
      shell: false
    });
    if (probe.status === 0) {
      return candidate;
    }
  }

  return undefined;
}
