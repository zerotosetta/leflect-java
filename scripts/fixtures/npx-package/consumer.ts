import {
  analyzeWorkspace, parseJsp, parseTld, loadTldRegistry,
  type JspParseOptions, type JspParseResult, type JspDocumentNode,
  type TldIndex, type LoadTldRegistryOptions, type TldRegistryDiagnostic,
  type LineRange, type TldRegistryEntry, type TldRegistryTag, type TldAttributeSchema
} from "leflect-java";

const parse: (content: string, options?: JspParseOptions) => JspParseResult = parseJsp;
const tld: (xml: string) => TldIndex = parseTld;
const options: LoadTldRegistryOptions = { root: ".", repoFiles: [], classpathEntries: [], autoLoad: true };
const registry: Promise<{ entries: TldRegistryEntry[]; diagnostics: TldRegistryDiagnostic[] }> = loadTldRegistry(options);
type El = Extract<JspDocumentNode, { kind: "ElExpression" }>["ast"];

function visitEl(node: El): string {
  switch (node.kind) {
    case "PropertyAccessExpression": return visitEl(node.target) + node.property;
    case "IndexAccessExpression": return visitEl(node.target) + visitEl(node.index);
    case "FunctionCallExpression": return visitEl(node.callee) + node.arguments.map(visitEl).join(",");
    case "UnaryExpression": return visitEl(node.argument);
    case "BinaryExpression": return visitEl(node.left) + node.operator + visitEl(node.right);
    case "TernaryExpression": return visitEl(node.test) + visitEl(node.consequent) + visitEl(node.alternate);
    case "GroupedExpression": return visitEl(node.expression);
    default: return node.raw;
  }
}

function visit(node: JspDocumentNode): string[] {
  const location: LineRange = node.lineRange;
  const values: string[] = [node.kind, String(location.startLine), String(location.endColumn)];
  if (node.kind === "CustomTagElement" || node.kind === "HtmlElement") {
    const attributes: Record<string, string> = node.attributes;
    values.push(...Object.values(attributes));
    for (const attribute of node.attributeNodes ?? []) values.push(...visit(attribute));
  }
  if (node.kind === "ElExpression") values.push(visitEl(node.ast));
  if ("children" in node) for (const child of node.children) values.push(...visit(child));
  return values;
}

const parsed = parse('<bank:task code="${customer.id}"/>', { sourceKind: "jsp" });
const values: string[] = visit(parsed.document);
const parsedTld = tld("<taglib><uri>urn:example</uri></taglib>");
const tags: TldRegistryTag[] = parsedTld.tags;
const attributes: TldAttributeSchema[] = tags.flatMap(tag => tag.attributes ?? []);
registry.then(result => result.entries.map(entry => [entry.uri, entry.sourcePath, entry.tags.map(tag => tag.handlerClass)]));
const analyze: typeof analyzeWorkspace = analyzeWorkspace;
void [values, attributes, analyze];
