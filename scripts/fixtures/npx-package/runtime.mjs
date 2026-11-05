import { analyzeWorkspace, run, parseJsp, parseTld, loadTldRegistry } from "leflect-java";
import verify from "./runtime-contract.cjs";
try {
  const result = await verify({ analyzeWorkspace, run, parseJsp, parseTld, loadTldRegistry }, "ESM");
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  globalThis.__leflectPackageProbe.finish();
  console.error(error); process.exitCode = 1;
}
