import type { LeflectPlugin } from "@leflect-java/schema";

export function dynamicQueryPlugin(): LeflectPlugin {
  return {
    name: "dynamic-query-plugin",
    enforce: "pre",
    hooks: [
      {
        id: "java-query-placeholder",
        target: "java",
        when(node) {
          return JSON.stringify(node).includes("account.selectBalance");
        },
        resolve() {
          return {
            matched: false,
            diagnostics: [
              "Query resolver execution is scaffolded by the public plugin API but not wired into the graph yet."
            ]
          };
        }
      }
    ]
  };
}
