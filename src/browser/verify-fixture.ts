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
 *     "args": { "limit": 3 },              // args to pass on verify invocation
 *     "expect": {
 *       "rowCount": { "min": 1, "max": 10 },  // inclusive bounds
 *       "columns":  ["a", "b"],                // every row must have these keys
 *       "types":    { "a": "string", "b": "number|string" },
 *       "patterns": { "url": "^https?://" },
 *       "notEmpty": ["title", "url"]           // trimmed string must be non-empty
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
};

export type Fixture = {
  args?: Record<string, unknown>;
  expect?: FixtureExpect;
};

export type ValidationFailure = {
  rule: 'rowCount' | 'column' | 'type' | 'pattern' | 'notEmpty';
  detail: string;
  rowIndex?: number;
};

export type Row = Record<string, unknown>;

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
export function deriveFixture(rows: Row[], args?: Record<string, unknown>): Fixture {
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
  });

  return failures;
}

function jsType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function typeMatches(actual: string, declared: string): boolean {
  const allowed = declared.split('|').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  if (allowed.includes('any')) return true;
  return allowed.includes(actual);
}
