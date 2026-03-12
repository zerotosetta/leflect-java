import type { LeflectPlugin } from "@leflect-java/schema";

export function interfacePlugin(): LeflectPlugin {
  return {
    name: "interface-plugin",
    enforce: "post",
    hooks: [
      {
        id: "java-interface-placeholder",
        target: "java",
        when(node) {
          return JSON.stringify(node).includes("IF_ACCOUNT_BALANCE");
        },
        resolve() {
          return {
            matched: false,
            diagnostics: [
              "Interface resolver execution is scaffolded by the public plugin API but not wired into the graph yet."
            ]
          };
        }
      }
    ]
  };
}
