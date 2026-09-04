/**
 * Magnitude formula evaluator — TDD §9.3.
 *
 * Fixed cent amounts go stale across a 30-year run with inflation and rising
 * income, so event magnitudes are expressions evaluated at fire time:
 *
 *   "cpi * 45000"                                  $450 in year-0 money
 *   "0.35 * monthlyIncome"                         proportional to this life
 *   "clamp(0.5*monthlyIncome, cpi*20000, cpi*250000)"
 *
 * This is a hand-written tokenizer and recursive-descent parser. It deliberately
 * does **not** use `eval` or `new Function`: content is data, and a data file
 * must never be able to reach the runtime. Anything outside the whitelist below
 * is a parse error, not a silent zero.
 */

/** Every function content may call. Nothing else resolves. */
export const FORMULA_FUNCTIONS = [
  'clamp',
  'min',
  'max',
  'round',
  'floor',
  'ceil',
  'abs',
  'price',
] as const;

export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

export class FormulaError extends Error {
  readonly source: string;

  constructor(message: string, source: string) {
    super(`${message} in formula: ${source}`);
    this.name = 'FormulaError';
    this.source = source;
  }
}

export interface FormulaContext {
  /** Numeric variables — `cpi`, `monthlyIncome`, `carScrapValue`, and so on. */
  readonly vars: Readonly<Record<string, number>>;
  /** Backs `price('SAFE')`. Absent means the formula may not call it. */
  readonly price?: (assetId: string) => number;
}

const PUNCT = ['(', ')', ',', '+', '-', '*', '/'] as const;
type Punct = (typeof PUNCT)[number];

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'punct'; value: Punct };

function isPunct(c: string): c is Punct {
  return (PUNCT as readonly string[]).includes(c);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (isPunct(c)) {
      tokens.push({ kind: 'punct', value: c });
      i++;
      continue;
    }

    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < source.length && ((source[j] >= '0' && source[j] <= '9') || source[j] === '.')) j++;
      const text = source.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new FormulaError(`bad number '${text}'`, source);
      tokens.push({ kind: 'number', value });
      i = j;
      continue;
    }

    if (c === "'" || c === '"') {
      const end = source.indexOf(c, i + 1);
      if (end === -1) throw new FormulaError('unterminated string', source);
      tokens.push({ kind: 'string', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      tokens.push({ kind: 'ident', value: source.slice(i, j) });
      i = j;
      continue;
    }

    throw new FormulaError(`unexpected character '${c}'`, source);
  }

  return tokens;
}

/**
 * Evaluate a magnitude formula.
 *
 * Throws `FormulaError` on an unknown function, an unknown variable, or any
 * syntax the grammar does not cover — content bugs surface loudly at load or at
 * fire time rather than quietly becoming zero.
 */
export function evaluateFormula(source: string, context: FormulaContext): number {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const expectPunct = (value: string): void => {
    const token = peek();
    if (token?.kind !== 'punct' || token.value !== value) {
      throw new FormulaError(`expected '${value}'`, source);
    }
    pos++;
  };

  // expr := term (('+' | '-') term)*
  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.kind !== 'punct' || (token.value !== '+' && token.value !== '-')) return left;
      pos++;
      const right = parseTerm();
      left = token.value === '+' ? left + right : left - right;
    }
  }

  // term := factor (('*' | '/') factor)*
  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const token = peek();
      if (token?.kind !== 'punct' || (token.value !== '*' && token.value !== '/')) return left;
      pos++;
      const right = parseFactor();
      if (token.value === '/' && right === 0) throw new FormulaError('division by zero', source);
      left = token.value === '*' ? left * right : left / right;
    }
  }

  // factor := ('-' | '+') factor | primary
  function parseFactor(): number {
    const token = peek();
    if (token?.kind === 'punct' && (token.value === '-' || token.value === '+')) {
      pos++;
      const value = parseFactor();
      return token.value === '-' ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (token === undefined) throw new FormulaError('unexpected end of formula', source);

    if (token.kind === 'number') {
      pos++;
      return token.value;
    }

    if (token.kind === 'string') {
      throw new FormulaError('a string is only valid as a function argument', source);
    }

    if (token.kind === 'punct' && token.value === '(') {
      pos++;
      const value = parseExpr();
      expectPunct(')');
      return value;
    }

    if (token.kind === 'ident') {
      pos++;
      const next = peek();
      if (next?.kind === 'punct' && next.value === '(') return parseCall(token.value);

      // A bare identifier is a variable, and it must exist.
      if (!Object.prototype.hasOwnProperty.call(context.vars, token.value)) {
        throw new FormulaError(`unknown variable '${token.value}'`, source);
      }
      const value = context.vars[token.value];
      if (!Number.isFinite(value)) throw new FormulaError(`'${token.value}' is not finite`, source);
      return value;
    }

    throw new FormulaError(`unexpected token '${String(token.value)}'`, source);
  }

  function parseCall(name: string): number {
    if (!(FORMULA_FUNCTIONS as readonly string[]).includes(name)) {
      throw new FormulaError(`unknown function '${name}'`, source);
    }

    expectPunct('(');
    const numericArgs: number[] = [];
    const stringArgs: string[] = [];

    const closesImmediately = (): boolean => {
      const token = peek();
      return token?.kind === 'punct' && token.value === ')';
    };

    if (!closesImmediately()) {
      for (;;) {
        const token = peek();
        if (token?.kind === 'string') {
          pos++;
          stringArgs.push(token.value);
        } else {
          numericArgs.push(parseExpr());
        }
        const next = peek();
        if (next?.kind === 'punct' && next.value === ',') {
          pos++;
          continue;
        }
        break;
      }
    }
    expectPunct(')');

    return applyFunction(name as FormulaFunction, numericArgs, stringArgs, source, context);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new FormulaError('trailing tokens', source);
  if (!Number.isFinite(result)) throw new FormulaError('result is not finite', source);
  return result;
}

function applyFunction(
  name: FormulaFunction,
  args: readonly number[],
  strings: readonly string[],
  source: string,
  context: FormulaContext,
): number {
  const arity = (expected: number): void => {
    if (args.length !== expected) {
      throw new FormulaError(`${name}() takes ${expected} arguments, got ${args.length}`, source);
    }
  };

  switch (name) {
    case 'clamp': {
      arity(3);
      return Math.min(Math.max(args[0], args[1]), args[2]);
    }
    case 'min':
      if (args.length === 0) throw new FormulaError('min() needs arguments', source);
      return Math.min(...args);
    case 'max':
      if (args.length === 0) throw new FormulaError('max() needs arguments', source);
      return Math.max(...args);
    case 'round':
      arity(1);
      return Math.round(args[0]);
    case 'floor':
      arity(1);
      return Math.floor(args[0]);
    case 'ceil':
      arity(1);
      return Math.ceil(args[0]);
    case 'abs':
      arity(1);
      return Math.abs(args[0]);
    case 'price': {
      if (strings.length !== 1 || args.length !== 0) {
        throw new FormulaError("price() takes one asset id, e.g. price('SAFE')", source);
      }
      if (context.price === undefined) {
        throw new FormulaError('price() is not available in this context', source);
      }
      const value = context.price(strings[0]);
      if (!Number.isFinite(value)) throw new FormulaError(`no price for '${strings[0]}'`, source);
      return value;
    }
  }
}

/** A magnitude in content: either a literal number or a formula string. */
export type Magnitude = number | string;

/** Resolve a magnitude. Numbers pass through; strings are evaluated. */
export function resolveMagnitude(value: Magnitude, context: FormulaContext): number {
  return typeof value === 'number' ? value : evaluateFormula(value, context);
}

/** Resolve a magnitude to integer cents. Money is never a float. */
export function resolveCents(value: Magnitude, context: FormulaContext): number {
  return Math.round(resolveMagnitude(value, context));
}
