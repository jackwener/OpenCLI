/**
 * Verify fixture: structural expectations for `opencli browser verify` output.
 *
 * The adapter-author skill runbook says every published adapter must write a
 * fixture under `~/.opencli/sites/<site>/verify/<command>.json` so later verify
 * runs can catch shape regressions (missing columns, wrong types, bleeding
 * values) without relying on exact content match — BBS / news / market data is
 * too volatile for value equality.
 *
 * Schema:
 *   {
 *     // args can be either:
 *     //   - an object of named flags: { "limit": 3 }  → expands to `--limit 3`
 *     //   - a raw argv array:         ["123", "--limit", "3"]  → passed verbatim
 *     // Use the array form for adapters that take positional subjects (e.g. <tid>, <url>, <query>).
 *     "args": { "limit": 3 },
 *     "expect": {
 *       "rowCount": { "min": 1, "max": 10 },  // inclusive bounds
 *       "columns":  ["a", "b"],                // every row must have these keys
 *       "types":    { "a": "string", "b": "number|string" },
 *       "patterns": { "url": "^https?://" },
 *       "notEmpty": ["title", "url"],          // trimmed string must be non-empty
 *       "mustNotContain": {                     // catch content-contamination bleed
 *         "description": ["address:", "category:"]
 *       },
 *       "mustBeTruthy": ["count"]               // catch silent `|| 0` fallbacks
 *     }
 *   }
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type FixtureExpect = {
  rowCount?: { min?: number; max?: number };
  columns?: string[];
  types?: Record<string, string>;
  patterns?: Record<string, string>;
  notEmpty?: string[];
  /**
   * Substrings/regex fragments that MUST NOT appear in the column value.
   *
   * Catches silent content contamination that `notEmpty` alone misses —
   * e.g. a `description` field that accidentally carries "address: ..." /
   * "category: ..." fragments from sibling DOM nodes, or a `title` that
   * bled in a navigation-breadcrumb prefix. Each entry is matched as a
   * plain substring against the stringified column value.
   */
  mustNotContain?: Record<string, string[]>;
  /**
   * Columns whose values must be truthy. Complements `notEmpty` (which
   * only rejects empty-string/null/undefined) by also catching silent
   * `|| 0` / `|| false` fallbacks in numeric/boolean fields. Fires when
   * the value coerces to `false` in JS.
   */
  mustBeTruthy?: string[];
};

export type FixtureArgs = Record<string, unknown> | unknown[];

export type Fixture = {
  args?: FixtureArgs;
  expect?: FixtureExpect;
};

export type ValidationFailure = {
  rule:
    | 'rowCount'
    | 'column'
    | 'type'
    | 'pattern'
    | 'notEmpty'
    | 'mustNotContain'
    | 'mustBeTruthy'
    | 'shapeKeyCount'
    | 'shapeDepth'
    | 'shapeNestedId';
  detail: string;
  rowIndex?: number;
};

export type Row = Record<string, unknown>;

export type RowShapeOptions = {
  maxTopLevelKeys?: number;
  maxNestedDepth?: number;
};

const DEFAULT_MAX_TOP_LEVEL_KEYS = 12;
const DEFAULT_MAX_NESTED_DEPTH = 1;
const ID_SHAPED_KEY_PATTERNS = [
  /^id$/i,
  /_id$/i,
  /Id$/,
  /^short_id$/i,
  /^bvid$/i,
  /^aid$/i,
  /^tid$/i,
  /^asin$/i,
  /^sku$/i,
  /^isbn$/i,
  /^doi$/i,
  /^slug$/i,
  /^hn_id$/i,
  /^username$/i,
  /^handle$/i,
  /^uri$/i,
];

export function fixturePath(site: string, command: string): string {
  return path.join(os.homedir(), '.opencli', 'sites', site, 'verify', `${command}.json`);
}

export function loadFixture(site: string, command: string): Fixture | null {
  const p = fixturePath(site, command);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Fixture;
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse fixture ${p}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function writeFixture(site: string, command: string, fixture: Fixture): string {
  const p = fixturePath(site, command);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(fixture, null, 2)}\n`, 'utf-8');
  return p;
}

/**
 * Derive a reasonable fixture from sample output. Used by `--write-fixture`
 * to seed a first draft the author can hand-tune.
 *
 * Heuristics:
 * - rowCount.min = 1 if rows non-empty, else 0
 * - columns = keys from the first row
 * - types = typeof of the first row's values, with "number|string" for mixed
 * - no auto patterns / notEmpty — author should add those deliberately
 */
export function deriveFixture(rows: Row[], args?: FixtureArgs): Fixture {
  const expect: FixtureExpect = {};
  if (rows.length === 0) {
    expect.rowCount = { min: 0 };
    return { ...(args ? { args } : {}), expect };
  }
  expect.rowCount = { min: 1 };

  const first = rows[0];
  const columns = Object.keys(first);
  expect.columns = columns;

  const types: Record<string, string> = {};
  for (const col of columns) {
    const observed = new Set<string>();
    for (const row of rows) {
      const v = row[col];
      observed.add(jsType(v));
    }
    types[col] = [...observed].sort().join('|');
  }
  expect.types = types;

  return { ...(args ? { args } : {}), expect };
}

export function validateRows(rows: Row[], fixture: Fixture): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const expect = fixture.expect;
  if (!expect) return failures;

  if (expect.rowCount) {
    const { min, max } = expect.rowCount;
    if (typeof min === 'number' && rows.length < min) {
      failures.push({ rule: 'rowCount', detail: `got ${rows.length} rows, expected at least ${min}` });
    }
    if (typeof max === 'number' && rows.length > max) {
      failures.push({ rule: 'rowCount', detail: `got ${rows.length} rows, expected at most ${max}` });
    }
  }

  const columns = expect.columns ?? [];
  const types = expect.types ?? {};
  const patterns = expect.patterns ?? {};
  const notEmpty = expect.notEmpty ?? [];

  const compiledPatterns: Record<string, RegExp> = {};
  for (const [col, src] of Object.entries(patterns)) {
    try {
      compiledPatterns[col] = new RegExp(src);
    } catch (err) {
      failures.push({ rule: 'pattern', detail: `pattern for "${col}" invalid: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  rows.forEach((row, i) => {
    for (const col of columns) {
      if (!(col in row)) {
        failures.push({ rule: 'column', detail: `missing column "${col}"`, rowIndex: i });
      }
    }
    for (const [col, declared] of Object.entries(types)) {
      if (!(col in row)) continue;
      const actual = jsType(row[col]);
      if (!typeMatches(actual, declared)) {
        failures.push({
          rule: 'type',
          detail: `"${col}" is ${actual}, expected ${declared}`,
          rowIndex: i,
        });
      }
    }
    for (const [col, re] of Object.entries(compiledPatterns)) {
      if (!(col in row)) continue;
      const v = row[col];
      if (v === null || v === undefined) continue;
      if (!re.test(String(v))) {
        failures.push({
          rule: 'pattern',
          detail: `"${col}"=${JSON.stringify(String(v).slice(0, 60))} does not match /${re.source}/`,
          rowIndex: i,
        });
      }
    }
    for (const col of notEmpty) {
      const v = row[col];
      if (v === null || v === undefined || String(v).trim() === '') {
        failures.push({ rule: 'notEmpty', detail: `"${col}" is empty`, rowIndex: i });
      }
    }
    for (const [col, needles] of Object.entries(expect.mustNotContain ?? {})) {
      if (!(col in row)) continue;
      const v = row[col];
      if (v === null || v === undefined) continue;
      const haystack = String(v);
      for (const needle of needles) {
        if (haystack.includes(needle)) {
          failures.push({
            rule: 'mustNotContain',
            detail: `"${col}" contains forbidden substring ${JSON.stringify(needle)}`,
            rowIndex: i,
          });
        }
      }
    }
    for (const col of expect.mustBeTruthy ?? []) {
      if (!(col in row)) continue;
      if (!row[col]) {
        failures.push({
          rule: 'mustBeTruthy',
          detail: `"${col}" is falsy (${JSON.stringify(row[col])}) — likely silent fallback`,
          rowIndex: i,
        });
      }
    }
  });

  return failures;
}

export function validateRowShape(rows: Row[], opts: RowShapeOptions = {}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const maxTopLevelKeys = opts.maxTopLevelKeys ?? DEFAULT_MAX_TOP_LEVEL_KEYS;
  const maxNestedDepth = opts.maxNestedDepth ?? DEFAULT_MAX_NESTED_DEPTH;

  rows.forEach((row, i) => {
    const keys = Object.keys(row);
    if (keys.length > maxTopLevelKeys) {
      failures.push({
        rule: 'shapeKeyCount',
        detail: `row has ${keys.length} top-level keys, expected at most ${maxTopLevelKeys}`,
        rowIndex: i,
      });
    }

    for (const [key, value] of Object.entries(row)) {
      const depth = nestedDepth(value);
      if (depth > maxNestedDepth) {
        failures.push({
          rule: 'shapeDepth',
          detail: `"${key}" nesting depth is ${depth}, expected at most ${maxNestedDepth}`,
          rowIndex: i,
        });
      }

      for (const path of nestedIdPaths(value, key)) {
        failures.push({
          rule: 'shapeNestedId',
          detail: `id-shaped field "${path}" must be a top-level row key`,
          rowIndex: i,
        });
      }
    }
  });

  return failures;
}

/**
 * Convert fixture args into argv tokens appended after the command name.
 * - Array form is passed through verbatim (stringified), supporting positional subjects.
 * - Object form is expanded to `--key value` pairs.
 */
export function expandFixtureArgs(args: FixtureArgs | undefined): string[] {
  if (!args) return [];
  if (Array.isArray(args)) return args.map((v) => String(v));
  const out: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    out.push(`--${k}`, String(v));
  }
  return out;
}

export function parseSeedArgs(raw: string | undefined): FixtureArgs | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return [parsed];
  } catch {
    return [raw];
  }
}

function jsType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function nestedDepth(value: unknown): number {
  if (value === null || value === undefined || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return 1 + Math.max(...value.map(nestedDepth));
  }
  const values = Object.values(value as Record<string, unknown>);
  if (values.length === 0) return 1;
  return 1 + Math.max(...values.map(nestedDepth));
}

function nestedIdPaths(value: unknown, prefix: string): string[] {
  if (value === null || value === undefined || typeof value !== 'object') return [];
  const paths: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...nestedIdPaths(item, `${prefix}[${index}]`));
    });
    return paths;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${prefix}.${key}`;
    if (isIdShapedKey(key)) paths.push(childPath);
    paths.push(...nestedIdPaths(nested, childPath));
  }
  return paths;
}

function isIdShapedKey(key: string): boolean {
  return ID_SHAPED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function typeMatches(actual: string, declared: string): boolean {
  const allowed = declared.split('|').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  if (allowed.includes('any')) return true;
  return allowed.includes(actual);
}
