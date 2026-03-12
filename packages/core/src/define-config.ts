import { LeflectConfigInput } from "@leflect-java/schema";

export function defineConfig<T extends LeflectConfigInput>(config: T): T {
  return config;
}
