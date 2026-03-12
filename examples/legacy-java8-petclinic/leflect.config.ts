import { defineConfig } from "@leflect-java/core";

export default defineConfig({
  analysisOut: "./analysis",
  ignoreFile: "./.gitignore",
  labelsOut: "./analysis/index/labels.json",
  classpathDiscovery: {
    enabled: true
  },
  java: {
    mavenCommand: "./mvnw"
  },
  jsp: {
    astMode: "jasper",
    webappRoot: "./src/main/webapp",
    generatedJavaOut: "./analysis/generated-jsp-java",
    astOut: "./analysis/jsp-ast",
    mavenCommand: "./mvnw"
  }
});
