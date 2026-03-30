import { ElAstNode } from "@leflect-java/schema";

type Token = {
  type: "identifier" | "number" | "string" | "operator" | "punctuation" | "literal" | "eof";
  value: string;
  start: number;
  end: number;
};

type ParsedNode = ElAstNode & {
  __start: number;
  __end: number;
};

const TEXTUAL_OPERATORS = new Set([
  "and",
  "or",
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "div",
  "mod",
  "not",
  "empty"
]);

const LITERAL_KEYWORDS = new Set(["true", "false", "null"]);

export function parseEl(expression: string): ElAstNode {
  const normalized = unwrapExpression(expression);
  if (!normalized.trim()) {
    return {
      kind: "RawExpression",
      raw: normalized,
      normalized
    };
  }

  try {
    const tokens = tokenize(normalized);
    const state = { tokens, index: 0, source: normalized };
    const node = parseTernary(state);
    const trailing = peek(state);

    if (trailing.type !== "eof") {
      return {
        kind: "RawExpression",
        raw: normalized,
        normalized
      };
    }

    return stripMeta(node);
  } catch (error) {
    return {
      kind: "UnknownExpression",
      raw: normalized,
      message: error instanceof Error ? error.message : "Failed to parse EL expression"
    };
  }
}

function parseTernary(state: ParserState): ParsedNode {
  const test = parseLogicalOr(state);
  if (!matchValue(state, "?")) {
    return test;
  }
  const consequent = parseTernary(state);
  expectValue(state, ":");
  const alternate = parseTernary(state);

  return node(state.source, "TernaryExpression", test.__start, alternate.__end, {
    test: stripMeta(test),
    consequent: stripMeta(consequent),
    alternate: stripMeta(alternate)
  });
}

function parseLogicalOr(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseLogicalAnd, ["||", "or"]);
}

function parseLogicalAnd(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseEquality, ["&&", "and"]);
}

function parseEquality(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseRelational, ["==", "!=", "eq", "ne"]);
}

function parseRelational(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseAdditive, ["<", "<=", ">", ">=", "lt", "le", "gt", "ge"]);
}

function parseAdditive(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseMultiplicative, ["+", "-"]);
}

function parseMultiplicative(state: ParserState): ParsedNode {
  return parseLeftAssociative(state, parseUnary, ["*", "/", "%", "div", "mod"]);
}

function parseLeftAssociative(
  state: ParserState,
  next: (state: ParserState) => ParsedNode,
  operators: string[]
): ParsedNode {
  let left = next(state);

  while (operators.includes(peek(state).value)) {
    const operator = advance(state);
    const right = next(state);
    left = node(state.source, "BinaryExpression", left.__start, right.__end, {
      operator: operator.value,
      left: stripMeta(left),
      right: stripMeta(right)
    });
  }

  return left;
}

function parseUnary(state: ParserState): ParsedNode {
  const token = peek(state);
  if (["!", "-", "not", "empty"].includes(token.value)) {
    advance(state);
    const argument = parseUnary(state);
    return node(state.source, "UnaryExpression", token.start, argument.__end, {
      operator: token.value,
      argument: stripMeta(argument)
    });
  }

  return parsePostfix(state);
}

function parsePostfix(state: ParserState): ParsedNode {
  let current = parsePrimary(state);

  while (true) {
    if (matchValue(state, ".")) {
      const property = expectIdentifier(state);
      current = node(state.source, "PropertyAccessExpression", current.__start, property.end, {
        target: stripMeta(current),
        property: property.value
      });
      continue;
    }

    if (matchValue(state, "[")) {
      const index = parseTernary(state);
      const close = expectValue(state, "]");
      current = node(state.source, "IndexAccessExpression", current.__start, close.end, {
        target: stripMeta(current),
        index: stripMeta(index)
      });
      continue;
    }

    if (matchValue(state, "(")) {
      const args: ElAstNode[] = [];
      if (!matchValue(state, ")")) {
        do {
          args.push(stripMeta(parseTernary(state)));
        } while (matchValue(state, ","));
        expectValue(state, ")");
      }

      const namespaceAndName = extractFunctionName(current);
      current = node(state.source, "FunctionCallExpression", current.__start, previous(state).end, {
        callee: stripMeta(current),
        namespace: namespaceAndName?.namespace,
        functionName: namespaceAndName?.functionName ?? current.raw,
        arguments: args
      });
      continue;
    }

    break;
  }

  return current;
}

function parsePrimary(state: ParserState): ParsedNode {
  const token = peek(state);

  if (matchValue(state, "(")) {
    const expression = parseTernary(state);
    const close = expectValue(state, ")");
    return node(state.source, "GroupedExpression", token.start, close.end, {
      expression: stripMeta(expression)
    });
  }

  if (token.type === "literal") {
    advance(state);
    return literalNode(state.source, token);
  }

  if (token.type === "string") {
    advance(state);
    return node(state.source, "LiteralExpression", token.start, token.end, {
      value: decodeString(token.value),
      valueType: "string"
    });
  }

  if (token.type === "number") {
    advance(state);
    return node(state.source, "LiteralExpression", token.start, token.end, {
      value: Number.parseFloat(token.value),
      valueType: "number"
    });
  }

  if (token.type === "identifier") {
    advance(state);
    return node(state.source, "IdentifierExpression", token.start, token.end, {
      name: token.value
    });
  }

  throw new Error(`Unexpected token ${token.value}`);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const start = index;
    const pair = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(pair)) {
      tokens.push({ type: "operator", value: pair, start, end: index + 2 });
      index += 2;
      continue;
    }

    if ("()[]?:.,+-*/%!<>".includes(char)) {
      tokens.push({
        type: ".?:,()[]".includes(char) ? "punctuation" : "operator",
        value: char,
        start,
        end: index + 1
      });
      index += 1;
      continue;
    }

    if (char === "'" || char === "\"") {
      const end = findStringEnd(source, index, char);
      tokens.push({
        type: "string",
        value: source.slice(index, end),
        start,
        end
      });
      index = end;
      continue;
    }

    if (/[0-9]/.test(char)) {
      index += 1;
      while (index < source.length && /[0-9.]/.test(source[index])) {
        index += 1;
      }
      tokens.push({
        type: "number",
        value: source.slice(start, index),
        start,
        end: index
      });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      index += 1;
      while (index < source.length && /[A-Za-z0-9_:]/.test(source[index])) {
        index += 1;
      }
      const value = source.slice(start, index);
      if (LITERAL_KEYWORDS.has(value)) {
        tokens.push({
          type: "literal",
          value,
          start,
          end: index
        });
        continue;
      }
      if (TEXTUAL_OPERATORS.has(value)) {
        tokens.push({
          type: "operator",
          value,
          start,
          end: index
        });
        continue;
      }
      tokens.push({
        type: "identifier",
        value,
        start,
        end: index
      });
      continue;
    }

    throw new Error(`Unexpected character ${char}`);
  }

  tokens.push({
    type: "eof",
    value: "",
    start: source.length,
    end: source.length
  });

  return tokens;
}

type ParserState = {
  tokens: Token[];
  index: number;
  source: string;
};

function peek(state: ParserState): Token {
  return state.tokens[state.index] ?? state.tokens[state.tokens.length - 1];
}

function previous(state: ParserState): Token {
  return state.tokens[Math.max(0, state.index - 1)];
}

function advance(state: ParserState): Token {
  const token = peek(state);
  state.index += 1;
  return token;
}

function matchValue(state: ParserState, value: string): boolean {
  if (peek(state).value !== value) {
    return false;
  }
  state.index += 1;
  return true;
}

function expectValue(state: ParserState, value: string): Token {
  const token = advance(state);
  if (token.value !== value) {
    throw new Error(`Expected ${value} but found ${token.value}`);
  }
  return token;
}

function expectIdentifier(state: ParserState): Token {
  const token = advance(state);
  if (token.type !== "identifier") {
    throw new Error(`Expected identifier but found ${token.value}`);
  }
  return token;
}

function literalNode(source: string, token: Token): ParsedNode {
  if (token.value === "true" || token.value === "false") {
    return node(source, "LiteralExpression", token.start, token.end, {
      value: token.value === "true",
      valueType: "boolean"
    });
  }

  return node(source, "LiteralExpression", token.start, token.end, {
    value: null,
    valueType: "null"
  });
}

function node<T extends ElAstNode["kind"]>(
  source: string,
  kind: T,
  start: number,
  end: number,
  extra: Omit<Extract<ElAstNode, { kind: T }>, "kind" | "raw">
): ParsedNode {
  return {
    kind,
    raw: source.slice(start, end),
    __start: start,
    __end: end,
    ...extra
  } as unknown as ParsedNode;
}

function stripMeta(node: ParsedNode): ElAstNode {
  const { __start, __end, ...result } = node;
  void __start;
  void __end;
  return result;
}

function extractFunctionName(node: ParsedNode): { namespace?: string; functionName: string } | undefined {
  if (node.kind === "IdentifierExpression") {
    const [namespace, functionName] = node.name.includes(":")
      ? node.name.split(":", 2)
      : [undefined, node.name];
    return {
      namespace,
      functionName
    };
  }

  if (node.kind === "PropertyAccessExpression") {
    return {
      functionName: node.property
    };
  }

  return undefined;
}

function unwrapExpression(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("${") || trimmed.startsWith("#{")) &&
    trimmed.endsWith("}")
  ) {
    return trimmed.slice(2, -1).trim();
  }
  return trimmed;
}

function findStringEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  throw new Error(`Unterminated string literal starting at ${start}`);
}

function decodeString(raw: string): string {
  const quote = raw[0];
  let value = raw.slice(1, -1);
  value = value.replace(/\\(["'])/g, "$1");
  if (quote === "\"") {
    value = value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return value;
}
