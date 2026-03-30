export type LineRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type TldSourceKind = "repo" | "configured-path" | "classpath" | "uri-map";

export type TldAttributeSchema = {
  name: string;
  required?: boolean;
  runtimeExpressionValue?: boolean;
  type?: string;
  fragment?: boolean;
};

export type TldRegistryTag = {
  name: string;
  handlerClass?: string;
  attributes?: TldAttributeSchema[];
  bodyContent?: string;
  dynamicAttributes?: boolean;
};

export type TldRegistryEntry = {
  uri?: string;
  sourcePath?: string;
  sourceKind?: TldSourceKind;
  tags: TldRegistryTag[];
};

type ElAstBase = {
  kind: string;
  raw: string;
};

export type ElLiteralNode = ElAstBase & {
  kind: "LiteralExpression";
  value: string | number | boolean | null;
  valueType: "string" | "number" | "boolean" | "null";
};

export type ElIdentifierNode = ElAstBase & {
  kind: "IdentifierExpression";
  name: string;
};

export type ElPropertyAccessNode = ElAstBase & {
  kind: "PropertyAccessExpression";
  target: ElAstNode;
  property: string;
};

export type ElIndexAccessNode = ElAstBase & {
  kind: "IndexAccessExpression";
  target: ElAstNode;
  index: ElAstNode;
};

export type ElFunctionCallNode = ElAstBase & {
  kind: "FunctionCallExpression";
  callee: ElAstNode;
  namespace?: string;
  functionName: string;
  arguments: ElAstNode[];
};

export type ElUnaryNode = ElAstBase & {
  kind: "UnaryExpression";
  operator: string;
  argument: ElAstNode;
};

export type ElBinaryNode = ElAstBase & {
  kind: "BinaryExpression";
  operator: string;
  left: ElAstNode;
  right: ElAstNode;
};

export type ElTernaryNode = ElAstBase & {
  kind: "TernaryExpression";
  test: ElAstNode;
  consequent: ElAstNode;
  alternate: ElAstNode;
};

export type ElGroupedNode = ElAstBase & {
  kind: "GroupedExpression";
  expression: ElAstNode;
};

export type ElRawNode = ElAstBase & {
  kind: "RawExpression";
  normalized: string;
};

export type ElUnknownNode = ElAstBase & {
  kind: "UnknownExpression";
  message: string;
};

export type ElAstNode =
  | ElLiteralNode
  | ElIdentifierNode
  | ElPropertyAccessNode
  | ElIndexAccessNode
  | ElFunctionCallNode
  | ElUnaryNode
  | ElBinaryNode
  | ElTernaryNode
  | ElGroupedNode
  | ElRawNode
  | ElUnknownNode;

export type JspSemanticDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  lineRange?: LineRange;
  sourceTag?: string;
  detail?: string;
};

export type JspResolverTagNode = {
  prefix: string;
  name: string;
  uri?: string;
  handlerClass?: string;
  raw: string;
  attributes: Record<string, string>;
  attributeExpressions: Record<string, ElAstNode | undefined>;
  lineRange: LineRange;
  bodyText?: string;
  children: JspSemanticNode[];
};

export type JspSemanticNodeBase = {
  kind: string;
  raw: string;
  lineRange: LineRange;
  children?: JspSemanticNode[];
};

export type JspTextNode = JspSemanticNodeBase & {
  kind: "TextNode";
  text: string;
};

export type JspElExpressionSemanticNode = JspSemanticNodeBase & {
  kind: "ElExpressionNode";
  expression: string;
  ast: ElAstNode;
};

export type JspHtmlElementNode = JspSemanticNodeBase & {
  kind: "HtmlElementNode";
  tagName: string;
  attributes: Record<string, string>;
};

export type JspCustomTagNode = JspSemanticNodeBase & {
  kind: "CustomTagNode";
  sourceTag: JspResolverTagNode;
  uri?: string;
  handlerClass?: string;
  attributes: Record<string, string>;
};

export type JspIfStatementNode = JspSemanticNodeBase & {
  kind: "IfStatement";
  sourceTag: JspResolverTagNode;
  condition?: ElAstNode;
};

export type JspChooseStatementNode = JspSemanticNodeBase & {
  kind: "ChooseStatement";
  sourceTag: JspResolverTagNode;
};

export type JspWhenBranchNode = JspSemanticNodeBase & {
  kind: "WhenBranch";
  sourceTag: JspResolverTagNode;
  condition?: ElAstNode;
};

export type JspOtherwiseBranchNode = JspSemanticNodeBase & {
  kind: "OtherwiseBranch";
  sourceTag: JspResolverTagNode;
};

export type JspLoopNode = JspSemanticNodeBase & {
  kind: "LoopNode";
  sourceTag: JspResolverTagNode;
  item?: string;
  collection?: ElAstNode;
  begin?: ElAstNode;
  end?: ElAstNode;
  step?: ElAstNode;
};

export type JspQueryNode = JspSemanticNodeBase & {
  kind: "QueryNode";
  sourceTag: JspResolverTagNode;
  queryId?: string;
  statement?: string;
  parameters?: Array<Record<string, unknown>>;
  dataSource?: string;
};

export type JspScriptletNode = JspSemanticNodeBase & {
  kind: "ScriptletNode" | "ExpressionNode" | "DeclarationNode";
  code: string;
  classReferences?: Array<{
    className: string;
    classPath?: string;
  }>;
  methodCalls?: Array<{
    methodName: string;
    methodId?: string;
    classPath?: string;
    qualifier?: string;
  }>;
};

export type JspIncludeReferenceNode = JspSemanticNodeBase & {
  kind: "IncludeReference";
  target: string;
};

export type JspSemanticRootNode = JspSemanticNodeBase & {
  kind: "Document";
  children: JspSemanticNode[];
};

export type JspSemanticNode =
  | JspSemanticRootNode
  | JspTextNode
  | JspElExpressionSemanticNode
  | JspHtmlElementNode
  | JspCustomTagNode
  | JspIfStatementNode
  | JspChooseStatementNode
  | JspWhenBranchNode
  | JspOtherwiseBranchNode
  | JspLoopNode
  | JspQueryNode
  | JspScriptletNode
  | JspIncludeReferenceNode;

export type JspSemanticSummary = {
  nodeCount: number;
  controlCount: number;
  queryCount: number;
  customTagCount: number;
  diagnosticCount: number;
};

export type JspSemanticAst = {
  schemaVersion: string;
  generatedAt: string;
  path: string;
  astMode: "lightweight" | "jasper";
  semanticSummary: JspSemanticSummary;
  root: JspSemanticRootNode;
  diagnostics: JspSemanticDiagnostic[];
};

export type JspTaglibResolverContext = {
  projectRoot: string;
  analysisOut: string;
  filePath: string;
  tag: JspResolverTagNode;
  tld?: TldRegistryEntry;
  parseEl(expression: string): ElAstNode;
};

export type JspTaglibResolver = (
  ctx: JspTaglibResolverContext
) =>
  | JspSemanticNode
  | JspSemanticNode[]
  | undefined
  | Promise<JspSemanticNode | JspSemanticNode[] | undefined>;
