/**
 * Hand-written NCalc-1.3.8.0-equivalent lexer + recursive-descent parser +
 * evaluator — module 08, `formula-engine.md` §2/§4 Option B. No dependency.
 *
 * PARITY (L-010) — the rules this file exists to reproduce exactly:
 *   - `^` is bitwise XOR, never power (power is `Pow(x, y)`).
 *   - `/` is ALWAYS float division: when neither operand is real, the left
 *     operand is coerced to double first (`5 / 2 === 2.5`). ÷0 → ±Infinity,
 *     never guarded to 0.
 *   - int/double/decimal value kinds with NCalc's coercions: int⊗int → int,
 *     int⊗double → double, int⊗decimal → decimal, decimal⊗double → THROW.
 *   - `if` / `in` are lowercase keywords; `If`/`In` are unknown → throw.
 *   - Function and parameter names are case-sensitive.
 *   - Numeric literals: `.` decimal separator only; no scientific notation,
 *     no string/date literals (D-10 narrowed grammar).
 *   - `[Bracketed name]` for any parameter; bare identifiers only for
 *     single-token names (`t`, `tr1`) — D-9.
 *
 * Precedence (NCalc grammar, low → high): `||` → `&&` → `|` → `^` → `&` →
 * `== !=` → `< > <= >=` → `+ -` → `* / %` → unary `- ! not` → primary.
 */
import {
  EngineValue,
  FUNCTION_TABLE,
  boolValue,
  doubleValue,
  intValue,
  toBool,
  toDouble,
  toUInt16,
} from "./functions";
import { Scope } from "./parameters";

// ── Lexer ────────────────────────────────────────────────────────────────────

type TokenType =
  | "number"
  | "identifier"
  | "bracketName"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

type Token = {
  type: TokenType;
  text: string;
  /** number tokens only */
  value?: number;
  /** number tokens only: integer literals are int, `1.5`/`.5` are double */
  numberKind?: "int" | "double";
  pos: number;
};

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    const pos = i;
    if (isDigit(c) || (c === "." && isDigit(input[i + 1] ?? ""))) {
      let j = i;
      while (j < input.length && isDigit(input[j])) j++;
      let numberKind: "int" | "double" = "int";
      if (input[j] === "." && isDigit(input[j + 1] ?? "")) {
        numberKind = "double";
        j++;
        while (j < input.length && isDigit(input[j])) j++;
      }
      const text = input.slice(i, j);
      tokens.push({
        type: "number",
        text,
        value: Number(text),
        numberKind,
        pos,
      });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < input.length && isIdentPart(input[j])) j++;
      tokens.push({ type: "identifier", text: input.slice(i, j), pos });
      i = j;
      continue;
    }
    if (c === "[") {
      const close = input.indexOf("]", i + 1);
      if (close < 0) {
        throw new Error(`Unterminated parameter bracket at position ${pos}`);
      }
      const name = input.slice(i + 1, close);
      if (name.length === 0) {
        throw new Error(`Empty parameter name at position ${pos}`);
      }
      tokens.push({ type: "bracketName", text: name, pos });
      i = close + 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", text: c, pos });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", text: c, pos });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma", text: c, pos });
      i++;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (
      two === "&&" ||
      two === "||" ||
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">="
    ) {
      tokens.push({ type: "operator", text: two, pos });
      i += 2;
      continue;
    }
    if ("+-*/%^&|<>!".includes(c)) {
      tokens.push({ type: "operator", text: c, pos });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at position ${pos}`);
  }
  tokens.push({ type: "eof", text: "", pos: input.length });
  return tokens;
}

// ── AST ──────────────────────────────────────────────────────────────────────

type Node =
  | { type: "number"; value: number; numberKind: "int" | "double" }
  | { type: "parameter"; name: string }
  | { type: "unary"; op: "-" | "!"; operand: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] }
  | { type: "if"; condition: Node; whenTrue: Node; whenFalse: Node }
  | { type: "in"; needle: Node; haystack: Node[] };

class Parser {
  private tokens: Token[];
  private index = 0;

  constructor(input: string) {
    this.tokens = tokenize(input);
  }

  parse(): Node {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw new Error(
        `Unexpected token '${trailing.text}' at position ${trailing.pos}`,
      );
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private matchOperator(...ops: string[]): string | null {
    const token = this.peek();
    if (token.type === "operator" && ops.includes(token.text)) {
      this.index++;
      return token.text;
    }
    // `and` / `or` / `not` keyword spellings (lowercase only — parity).
    if (token.type === "identifier") {
      if (token.text === "and" && ops.includes("&&")) {
        this.index++;
        return "&&";
      }
      if (token.text === "or" && ops.includes("||")) {
        this.index++;
        return "||";
      }
    }
    return null;
  }

  private binaryLevel(ops: string[], parseNext: () => Node): Node {
    let left = parseNext();
    let op = this.matchOperator(...ops);
    while (op !== null) {
      const right = parseNext();
      left = { type: "binary", op, left, right };
      op = this.matchOperator(...ops);
    }
    return left;
  }

  private parseOr = (): Node => this.binaryLevel(["||"], this.parseAnd);
  private parseAnd = (): Node => this.binaryLevel(["&&"], this.parseBitOr);
  private parseBitOr = (): Node => this.binaryLevel(["|"], this.parseBitXor);
  private parseBitXor = (): Node => this.binaryLevel(["^"], this.parseBitAnd);
  private parseBitAnd = (): Node => this.binaryLevel(["&"], this.parseEquality);
  private parseEquality = (): Node =>
    this.binaryLevel(["==", "!="], this.parseRelational);
  private parseRelational = (): Node =>
    this.binaryLevel(["<", ">", "<=", ">="], this.parseAdditive);
  private parseAdditive = (): Node =>
    this.binaryLevel(["+", "-"], this.parseMultiplicative);
  private parseMultiplicative = (): Node =>
    this.binaryLevel(["*", "/", "%"], this.parseUnary);

  private parseUnary = (): Node => {
    const token = this.peek();
    if (
      token.type === "operator" &&
      (token.text === "-" || token.text === "!")
    ) {
      this.index++;
      return { type: "unary", op: token.text, operand: this.parseUnary() };
    }
    if (token.type === "identifier" && token.text === "not") {
      this.index++;
      return { type: "unary", op: "!", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  };

  private expect(type: TokenType, what: string): Token {
    const token = this.next();
    if (token.type !== type) {
      throw new Error(
        `Expected ${what} but found '${token.text || "end of formula"}' at position ${token.pos}`,
      );
    }
    return token;
  }

  private parseArguments(): Node[] {
    this.expect("lparen", "'('");
    const args: Node[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseOr());
      while (this.peek().type === "comma") {
        this.index++;
        args.push(this.parseOr());
      }
    }
    this.expect("rparen", "')'");
    return args;
  }

  private parsePrimary(): Node {
    const token = this.next();
    if (token.type === "number") {
      return {
        type: "number",
        value: token.value as number,
        numberKind: token.numberKind as "int" | "double",
      };
    }
    if (token.type === "bracketName") {
      return { type: "parameter", name: token.text };
    }
    if (token.type === "lparen") {
      const node = this.parseOr();
      this.expect("rparen", "')'");
      return node;
    }
    if (token.type === "identifier") {
      // Lowercase `if` / `in` are grammar keywords (parity: `If`/`In` are
      // ordinary identifiers, resolve as unknown functions and throw → 0).
      if (this.peek().type === "lparen") {
        const args = this.parseArguments();
        if (token.text === "if") {
          if (args.length !== 3) {
            throw new Error("if() takes exactly 3 arguments");
          }
          return {
            type: "if",
            condition: args[0],
            whenTrue: args[1],
            whenFalse: args[2],
          };
        }
        if (token.text === "in") {
          if (args.length < 2) {
            throw new Error("in() takes at least 2 arguments");
          }
          return { type: "in", needle: args[0], haystack: args.slice(1) };
        }
        return { type: "call", name: token.text, args };
      }
      // Bare parameter name — single-token identifiers only (D-9).
      return { type: "parameter", name: token.text };
    }
    throw new Error(
      `Unexpected ${token.type === "eof" ? "end of formula" : `token '${token.text}'`} at position ${token.pos}`,
    );
  }
}

// ── Evaluator ────────────────────────────────────────────────────────────────

type NumericKind = "int" | "double" | "decimal";

/**
 * NCalc `Numbers` type-promotion for `+ - * %`: int⊗int → int, int⊗double →
 * double, int⊗decimal → decimal, decimal⊗double → THROW (the `Abs(-7) +
 * Sqrt(16)` → 0 rule). Booleans never participate in arithmetic.
 */
function arithmeticKind(a: EngineValue, b: EngineValue): NumericKind {
  if (a.kind === "bool" || b.kind === "bool") {
    throw new Error("Arithmetic is not defined for booleans");
  }
  if (
    (a.kind === "decimal" && b.kind === "double") ||
    (a.kind === "double" && b.kind === "decimal")
  ) {
    throw new Error("Cannot mix decimal and double operands");
  }
  if (a.kind === "decimal" || b.kind === "decimal") return "decimal";
  if (a.kind === "double" || b.kind === "double") return "double";
  return "int";
}

function evaluateArithmetic(
  op: string,
  a: EngineValue,
  b: EngineValue,
): EngineValue {
  if (op === "/") {
    // NCalc `/` is ALWAYS float division: when neither operand is real, the
    // LEFT operand is coerced to double (decompiled EvaluationVisitor, Div
    // case). Never emulate integer division. ÷0 → ±Infinity as in IEEE-754.
    const kind = arithmeticKind(a, b);
    const right = toDouble(b);
    if (kind === "decimal" && right === 0) {
      // .NET decimal division by zero throws (→ silent 0), unlike double.
      throw new Error("Attempted to divide by zero");
    }
    return {
      kind: kind === "int" ? "double" : kind,
      value: toDouble(a) / right,
    };
  }
  const kind = arithmeticKind(a, b);
  const x = toDouble(a);
  const y = toDouble(b);
  let value: number;
  switch (op) {
    case "+":
      value = x + y;
      break;
    case "-":
      value = x - y;
      break;
    case "*":
      value = x * y;
      break;
    case "%":
      value = x % y;
      break;
    default:
      throw new Error(`Unknown arithmetic operator '${op}'`);
  }
  return { kind, value };
}

function evaluateBinary(
  op: string,
  a: EngineValue,
  b: EngineValue,
): EngineValue {
  switch (op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
      return evaluateArithmetic(op, a, b);
    // Bitwise operands go through Convert.ToUInt16 (see functions.ts).
    case "&":
      return intValue(toUInt16(a) & toUInt16(b));
    case "|":
      return intValue(toUInt16(a) | toUInt16(b));
    case "^":
      // PARITY: `^` is bitwise XOR in NCalc, NOT exponentiation (3 ^ 2 = 1).
      return intValue(toUInt16(a) ^ toUInt16(b));
    case "==":
      return boolValue(toDouble(a) === toDouble(b));
    case "!=":
      return boolValue(toDouble(a) !== toDouble(b));
    case "<":
      return boolValue(toDouble(a) < toDouble(b));
    case ">":
      return boolValue(toDouble(a) > toDouble(b));
    case "<=":
      return boolValue(toDouble(a) <= toDouble(b));
    case ">=":
      return boolValue(toDouble(a) >= toDouble(b));
    default:
      throw new Error(`Unknown operator '${op}'`);
  }
}

function evaluateNode(node: Node, scope: Scope): EngineValue {
  switch (node.type) {
    case "number":
      return node.numberKind === "int"
        ? intValue(node.value)
        : doubleValue(node.value);
    case "parameter": {
      // Case-sensitive; absent/null/undefined is an error, never NaN.
      const value = Object.prototype.hasOwnProperty.call(scope, node.name)
        ? scope[node.name]
        : undefined;
      if (typeof value !== "number") {
        throw new Error(`Parameter was not defined: '${node.name}'`);
      }
      // Bound parameters are doubles (`formula-engine.md` §1/§6 Mobius note).
      return doubleValue(value);
    }
    case "unary": {
      const operand = evaluateNode(node.operand, scope);
      if (node.op === "!") return boolValue(!toBool(operand));
      if (operand.kind === "bool") {
        throw new Error("Cannot negate a boolean");
      }
      return { kind: operand.kind, value: -operand.value };
    }
    case "binary": {
      // Logical operators short-circuit (Convert.ToBoolean semantics).
      if (node.op === "&&") {
        const left = toBool(evaluateNode(node.left, scope));
        return boolValue(left && toBool(evaluateNode(node.right, scope)));
      }
      if (node.op === "||") {
        const left = toBool(evaluateNode(node.left, scope));
        return boolValue(left || toBool(evaluateNode(node.right, scope)));
      }
      return evaluateBinary(
        node.op,
        evaluateNode(node.left, scope),
        evaluateNode(node.right, scope),
      );
    }
    case "call": {
      const fn = FUNCTION_TABLE[node.name];
      if (!fn) {
        // Case-sensitive lookup: `abs`, `If`, `Ln` all land here → throw → 0.
        throw new Error(`Function not found: '${node.name}'`);
      }
      if (node.args.length !== fn.arity) {
        throw new Error(
          `${node.name}() takes exactly ${fn.arity} argument${fn.arity === 1 ? "" : "s"}`,
        );
      }
      return fn.apply(node.args.map((arg) => evaluateNode(arg, scope)));
    }
    case "if":
      // Lazy branches, as NCalc's if() — only the taken branch evaluates.
      return toBool(evaluateNode(node.condition, scope))
        ? evaluateNode(node.whenTrue, scope)
        : evaluateNode(node.whenFalse, scope);
    case "in": {
      const needle = toDouble(evaluateNode(node.needle, scope));
      for (const candidate of node.haystack) {
        if (toDouble(evaluateNode(candidate, scope)) === needle) {
          return boolValue(true);
        }
      }
      return boolValue(false);
    }
  }
}

/**
 * Parse + evaluate one formula against a scope. Throws on any lexical,
 * syntactic, name-resolution, arity or type error — callers decide whether
 * to swallow (evaluate → 0) or surface (validate). The final result mirrors
 * `Convert.ToDouble(expression.Evaluate())`: booleans become 1/0 and
 * non-finite doubles pass through unguarded (÷0 → Infinity — parity).
 */
export function parseAndEvaluate(formula: string, scope: Scope): number {
  const root = new Parser(formula).parse();
  return toDouble(evaluateNode(root, scope));
}
