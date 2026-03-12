import { defineConfig } from "@leflect-java/core";

export default defineConfig({
  analysisOut: "./analysis",
  ignoreFile: "./.gitignore",
  labelsOut: "./analysis/index/labels.json",
  classpathDiscovery: {
    enabled: true
  },
  entryFiles: {
    java: ["LegacyOwnerConsoleAdapter\\.java$"],
    jsp: ["WEB-INF/jsp/legacy/.+\\.jsp$"]
  },
  entries: [
    {
      id: "legacy.owner.console",
      type: "virtual_page",
      label: "Legacy Owner Console",
      description: "Virtual page sample with JSP fan-out and a six-hop adapter chain into Java files.",
      jsp: [
        "src/main/webapp/WEB-INF/jsp/legacy/virtualOwnerConsole.jsp",
        "src/main/webapp/WEB-INF/jsp/legacy/fragments/ownerConsolePanel.jsp"
      ],
      tags: ["legacy", "sample", "depth-5"],
      variants: [
        {
          id: "legacy.owner.console.adapter",
          label: "Legacy Owner Console Adapter Seed",
          java: [
            "src/main/java/org/springframework/samples/petclinic/web/legacy/LegacyOwnerConsoleAdapter.java"
          ],
          tags: ["adapter"]
        }
      ]
    }
  ],
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
