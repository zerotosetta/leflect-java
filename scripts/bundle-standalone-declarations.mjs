import fs from "node:fs/promises";
import path from "node:path";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import ts from "typescript";

/** Bundle the compiled public declaration graph, including private reachable AST types. */
export async function bundleStandaloneDeclarations(input, output) {
  const expected = exportedSymbols(input);
  const bundle = await rollup({
    input,
    external: () => false,
    plugins: [dts({ respectExternal: true })],
    onwarn(warning, warn) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
      warn(warning);
    }
  });
  try {
    await bundle.write({ file: output, format: "es" });
  } finally {
    await bundle.close();
  }

  const source = ts.createSourceFile(output, await fs.readFile(output, "utf8"), ts.ScriptTarget.Latest, true);
  const references = [];
  function inspect(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      references.push(node.moduleSpecifier.getText(source));
    }
    if (ts.isImportTypeNode(node)) references.push(node.argument.getText(source));
    if (ts.isExternalModuleReference(node)) references.push(node.expression?.getText(source));
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  references.push(...source.referencedFiles.map(reference => reference.fileName),
    ...source.typeReferenceDirectives.map(reference => reference.fileName));
  if (references.length) {
    throw new Error(`Standalone declarations retain external references: ${references.join(", ")}`);
  }

  const program = ts.createProgram([output], compilerOptions(false));
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost));
  }
  const actual = exportedSymbols(output);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Standalone declaration bundling changed the public export names or value/type surface");
  }
  return { exports: actual.names, valueExports: actual.values };
}

function exportedSymbols(file) {
  const program = ts.createProgram([file], compilerOptions(true));
  const source = program.getSourceFile(path.resolve(file));
  if (!source) throw new Error(`Declaration entry could not be loaded: ${file}`);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`Declaration entry has no public module exports: ${file}`);
  const symbols = checker.getExportsOfModule(moduleSymbol);
  const names = symbols.map(symbol => symbol.name).sort();
  const values = symbols.filter(symbol => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return Boolean(target.flags & ts.SymbolFlags.Value);
  }).map(symbol => symbol.name).sort();
  return { names, values };
}

function compilerOptions(skipLibCheck) {
  return { strict: true, skipLibCheck, noEmit: true, types: [], lib: ["lib.es2022.d.ts"],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 };
}

const diagnosticHost = {
  getCanonicalFileName: file => file,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => "\n"
};
