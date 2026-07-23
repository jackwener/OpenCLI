# Expand `ke zufang` Filters & Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Beike rental filters (方式/户型/朝向/特色/租期/楼层/电梯) and result sort (`--sort`) to `opencli ke zufang`, encoded as URL path code segments on `zu.ke.com`.

**Architecture:** A new pure module `clis/ke/zufang-filters.js` (separate from ershoufang's `filters.js` — zufang uses its own codes on a different subdomain) owns the keyword→code tables and `buildZufangFilterPath(kwargs)`, which emits all active codes (including the unchanged `rp{min}t{max}` rent segment) in Beike's canonical order. `clis/ke/zufang.js` gains the arg defs and delegates URL-segment assembly to that helper; its DOM scraping is unchanged. All zufang codes are confirmed against the live rental site first.

**Tech Stack:** Node ESM JS adapters (`@jackwener/opencli/registry`, `errors`), vitest (`adapter` project), `opencli browser` for live verification.

Spec: `docs/superpowers/specs/2026-06-16-ke-zufang-filters-sort-design.md`

---

## File Structure

- **Create** `clis/ke/zufang-filters.js` — mapping tables + `buildZufangFilterPath`. Pure, browser-free.
- **Create** `clis/ke/zufang-filters.test.js` — unit tests for the helper (vitest `adapter` project).
- **Create** `clis/ke/zufang.test.js` — command-level URL assembly + backward-compat tests.
- **Modify** `clis/ke/zufang.js` — add arg defs, import helper, replace inline URL assembly.

`clis/ke/utils.js` (gotoKe) is reused unchanged. `clis/ke/filters.js` (ershoufang) is NOT touched or imported.

---

## Task 1: Verify zufang codes, sort mechanism & canonical order (live)

Confirms every code, the canonical concatenation order, AND whether sort is a path
segment or a query param. Needs a Chrome logged into ke.com with the OpenCLI extension
(zufang strategy is `COOKIE`). Output: confirmed code values + ≥2 captured golden URLs
written straight into `clis/ke/zufang-filters.test.js`.

**Files:** Create `clis/ke/zufang-filters.test.js` (golden tests only, this task).

- [ ] **Step 1: Open the reference rental page**

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser zufang open "https://sh.zu.ke.com/zufang/pudong/"
```

Expected: a 浦东 租房 list loads. Solve any captcha/login in that window first.

- [ ] **Step 2: Toggle each in-scope filter, record the code it adds to the URL**

Click ONE option at a time, read the path segment that appears (use
`npx tsx src/main.ts browser zufang state | grep -i title` to read the URL/title). Cover:

- 方式: 整租 / 合租  → rent-type codes
- 户型: 一居 / 两居 / 三居 / 四居+  → rooms codes
- 朝向: 东 / 西 / 南 / 北 / 南北  → orientation codes
- 特色: 近地铁 / 拎包入住 / 精装修 / 押一付一 / 新上 / 认证公寓 / 随时看房 / VR房源 / 业主自荐  → feature codes
- 租期: 月租 / 年租 / 一个月起租 / 1-3个月 / 4-6个月  → lease-term codes
- 楼层: 低楼层 / 中楼层 / 高楼层  → floor codes
- 电梯: 有电梯 / 无电梯  → elevator codes

- [ ] **Step 3: Determine the sort mechanism**

Click each sort tab (综合排序 / 最新上架 / 价格 / 面积; price & area likely toggle asc/desc on
repeat click) and read what changes. **Critical:** note whether sort appears as a PATH
segment (e.g. `.../co32/`) or a QUERY param (e.g. `?sort=...`). Record each sort value's code.

- [ ] **Step 4: Establish canonical order + rent-segment position**

Select several filters at once (e.g. 整租 + 两居 + 近地铁 + 低楼层 + a rent range via the
自定义 box). Read the full path and note the left-to-right prefix order, INCLUDING where the
rent `rp...` segment sits among the new codes.

- [ ] **Step 5: Spot-check city stability**

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser zufang open "https://bj.zu.ke.com/zufang/"
```

Re-check ~3 enums; confirm in-scope codes match sh.

- [ ] **Step 6: Write the captured URLs as golden tests**

Create `clis/ke/zufang-filters.test.js` with the imports and the ≥2 real multi-filter URLs
you captured, as golden assertions. Use this exact skeleton, filling the `kwargs` and
expected string from YOUR captures (example shown; replace with real values):

```js
import { describe, expect, it } from 'vitest';
import {
  buildZufangFilterPath,
  RENT_TYPE, ORIENTATION, FEATURES, LEASE_TERM, FLOOR, ELEVATOR, SORT,
} from './zufang-filters.js';

describe('buildZufangFilterPath — live golden URLs', () => {
  // Replace each kwargs+expected with a URL captured in Task 1 Step 4.
  it('matches captured multi-filter URL #1', () => {
    expect(buildZufangFilterPath({
      'rent-type': 'whole', rooms: 2, features: 'near-subway', floor: 'low',
    })).toBe('REPLACE_WITH_CAPTURED_SEGMENT_1');
  });
  it('matches captured multi-filter URL #2', () => {
    expect(buildZufangFilterPath({
      orientation: 'south', 'lease-term': 'monthly', elevator: 'yes', sort: 'newest',
    })).toBe('REPLACE_WITH_CAPTURED_SEGMENT_2');
  });
});
```

- [ ] **Step 7: Close the window**

```bash
npx tsx src/main.ts browser zufang close
```

**Output:** confirmed keyword→code values (kept in your notes for Task 2) + a
`zufang-filters.test.js` whose two golden tests encode real captured URLs. If Step 3 found
sort is a query param (not a path segment), note it loudly — Task 2/3 handle it (see Task 3
Step 3 alt).

---

## Task 2: Create the `zufang-filters.js` helper (TDD)

**Files:**
- Create: `clis/ke/zufang-filters.js`
- Test: `clis/ke/zufang-filters.test.js` (extend the golden file from Task 1)

- [ ] **Step 1: Add parametric tests**

Append to `clis/ke/zufang-filters.test.js`:

```js
describe('buildZufangFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildZufangFilterPath({})).toBe('');
  });
  it('maps each single-value enum through its own table', () => {
    expect(buildZufangFilterPath({ 'rent-type': 'whole' })).toBe(RENT_TYPE.whole);
    expect(buildZufangFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildZufangFilterPath({ 'lease-term': 'monthly' })).toBe(LEASE_TERM.monthly);
    expect(buildZufangFilterPath({ floor: 'low' })).toBe(FLOOR.low);
    expect(buildZufangFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildZufangFilterPath({ sort: 'newest' })).toBe(SORT.newest);
  });
  it('encodes rooms via the rooms producer', () => {
    // exact prefix confirmed in Task 1; assert non-empty + stable
    const out = buildZufangFilterPath({ rooms: 2 });
    expect(out).toBeTruthy();
    expect(buildZufangFilterPath({ rooms: 2 })).toBe(out);
  });
  it('keeps the existing rent encoding rp{min}t{max}', () => {
    expect(buildZufangFilterPath({ 'min-price': 2000, 'max-price': 8000 })).toBe('rp2000t8000');
  });
  it('splits --features and emits feature codes in table-definition order', () => {
    const expected = FEATURES['near-subway'] + FEATURES.fine;
    expect(buildZufangFilterPath({ features: 'fine,near-subway' })).toBe(expected);
  });
  it('throws on an unknown feature keyword', () => {
    expect(() => buildZufangFilterPath({ features: 'bogus' })).toThrow(/unknown/i);
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildZufangFilterPath({ rooms: 2, 'rent-type': 'whole', floor: 'low' });
    const b = buildZufangFilterPath({ floor: 'low', 'rent-type': 'whole', rooms: 2 });
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project adapter clis/ke/zufang-filters.test.js`
Expected: FAIL — `Failed to resolve import "./zufang-filters.js"`.

- [ ] **Step 3: Implement `clis/ke/zufang-filters.js`**

Paste the codes confirmed in Task 1 into the tables (values below are starting guesses —
REPLACE each with your Task 1 capture; the rent `rp{min}t{max}` form is already correct):

```js
import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike zu.ke.com code. CONFIRM/REPLACE every value from Task 1.
export const RENT_TYPE = { whole: 'rt200600000001', shared: 'rt200600000002' };
export const ORIENTATION = {
  'south-north': 'f5', south: 'f2', east: 'f1', north: 'f4', west: 'f3',
};
export const FEATURES = {
  'near-subway': 'nb1', 'bag-in': 'bi1', fine: 'de1', 'deposit-one': 'dp1',
  new: 'nd1', certified: 'ct1', 'anytime-view': 'av1', vr: 'vr1', 'owner-rec': 'or1',
};
export const LEASE_TERM = {
  monthly: 'lt1', yearly: 'lt2', 'min-1month': 'lt3', '1-3months': 'lt4', '4-6months': 'lt5',
};
export const FLOOR = { low: 'lc1', mid: 'lc2', high: 'lc3' };
export const ELEVATOR = { yes: 'ie2', no: 'ie1' };
export const SORT = {
  newest: 'co32', 'rent-asc': 'co21', 'rent-desc': 'co22', 'area-asc': 'co11', 'area-desc': 'co12',
};

function present(v) {
  return v !== undefined && v !== null && v !== '';
}
function lookup(table, key) {
  if (!present(key)) return '';
  return table[String(key)] || '';
}
function roomsCode(rooms) {
  return rooms ? `l${rooms}` : ''; // ⚠️ confirm zufang rooms prefix in Task 1
}
function rentCode(kwargs) {
  // Unchanged from the original zufang.js — kept exactly as-is per the spec.
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!min && !max) return '';
  return `rp${min || ''}t${max || ''}`;
}
function featuresCode(raw) {
  if (!raw) return '';
  const requested = new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
  for (const key of requested) {
    if (!FEATURES[key]) {
      throw new ArgumentError(
        `unknown --features value: "${key}"`,
        `Allowed: ${Object.keys(FEATURES).join(', ')}`,
      );
    }
  }
  return Object.keys(FEATURES).filter((k) => requested.has(k)).map((k) => FEATURES[k]).join('');
}

// Canonical left-to-right order Beike concatenates prefixes in (confirmed in Task 1).
// Reorder these producers to match the order captured in Task 1 Step 4.
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(RENT_TYPE, k['rent-type']),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => featuresCode(k.features),
  (k) => lookup(LEASE_TERM, k['lease-term']),
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => roomsCode(k.rooms),
  (k) => rentCode(k),
];

/**
 * Build the Beike zufang filter/sort code segment for /zufang/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildZufangFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
```

- [ ] **Step 4: Reconcile with Task 1 findings**

Replace every table value and reorder `SEGMENT_PRODUCERS` to match your Task 1 captures.
Replace the two `REPLACE_WITH_CAPTURED_SEGMENT_*` strings in the golden tests with the real
captured segments. The parametric tests need no change — they read the tables.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project adapter clis/ke/zufang-filters.test.js`
Expected: PASS (golden + parametric all green).

- [ ] **Step 6: Commit**

```bash
git add clis/ke/zufang-filters.js clis/ke/zufang-filters.test.js
git commit -m "feat(ke): add zufang filter/sort code helper"
```

---

## Task 3: Wire the helper into `zufang.js` (TDD)

**Files:**
- Modify: `clis/ke/zufang.js`
- Test: `clis/ke/zufang.test.js`

- [ ] **Step 1: Write the failing command tests**

Create `clis/ke/zufang.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './zufang.js';
import { buildZufangFilterPath } from './zufang-filters.js';

const cmd = () => getRegistry().get('ke/zufang');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/zufang command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['rent-type', 'rooms', 'orientation', 'features',
                      'lease-term', 'floor', 'elevator', 'sort']) {
      expect(names).toContain(n);
    }
    const rt = c.args.find((a) => a.name === 'rent-type');
    expect(rt.choices).toEqual(['whole', 'shared']);
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'pudong', 'rent-type': 'whole', rooms: 2, limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildZufangFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.zu.ke.com/zufang/pudong/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: rent range only', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'sh', 'max-price': 8000, limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://sh.zu.ke.com/zufang/rpt8000/', expect.anything(),
    );
  });

  it('no district, no filters', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.zu.ke.com/zufang/', expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project adapter clis/ke/zufang.test.js`
Expected: FAIL — new args missing; combined URL differs from old inline logic.

- [ ] **Step 3: Update `clis/ke/zufang.js`**

Add the import after the existing imports:

```js
import { buildZufangFilterPath } from './zufang-filters.js';
```

Replace the `args: [ ... ]` array with:

```js
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, pudong' },
        { name: 'min-price', type: 'int', help: '最低月租（元）' },
        { name: 'max-price', type: 'int', help: '最高月租（元）' },
        { name: 'rooms', type: 'int', help: '户型居室数 (1-4)，4 表示四居及以上' },
        { name: 'rent-type', choices: ['whole', 'shared'], help: '方式：whole(整租)/shared(合租)' },
        { name: 'orientation', choices: ['south-north', 'south', 'east', 'north', 'west'], help: '朝向：south-north(南北)/south(南)/east(东)/north(北)/west(西)' },
        { name: 'features', help: '特色，逗号分隔多选：near-subway,bag-in,fine,deposit-one,new,certified,anytime-view,vr,owner-rec' },
        { name: 'lease-term', choices: ['monthly', 'yearly', 'min-1month', '1-3months', '4-6months'], help: '租期：monthly(月租)/yearly(年租)/min-1month(一个月起租)/1-3months/4-6months' },
        { name: 'floor', choices: ['low', 'mid', 'high'], help: '楼层：low(低)/mid(中)/high(高)' },
        { name: 'elevator', choices: ['yes', 'no'], help: '电梯：yes(有)/no(无)' },
        { name: 'sort', choices: ['newest', 'rent-asc', 'rent-desc', 'area-asc', 'area-desc'], help: '排序：newest(最新上架)/rent-asc|desc(租金)/area-asc|desc(面积)' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
```

Replace the URL-assembly block (the `let path` / `priceParts` / `filters` / `baseUrl` /
`url` lines, currently `clis/ke/zufang.js:24-38`) with:

```js
        let path = '/zufang/';
        if (kwargs.district) {
            path = `/zufang/${kwargs.district}/`;
        }

        const filters = buildZufangFilterPath(kwargs);
        const baseUrl = `https://${city}.zu.ke.com`;
        const url = baseUrl + path + (filters ? filters + '/' : '');
```

Leave everything else (`gotoKe`, the `page.evaluate` scrape, `.slice(0, limit)`) unchanged.

> **Step 3 alt (only if Task 1 found sort is a QUERY param, not a path segment):** drop
> `sort` from `SEGMENT_PRODUCERS` in `zufang-filters.js`, export a `sortQuery(kwargs)`
> that returns `?sort=<code>` (or ''), and in `zufang.js` append it:
> `const url = baseUrl + path + (filters ? filters + '/' : '') + sortQuery(kwargs);`
> Update the `sort` parametric/golden tests to assert the query form instead.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project adapter clis/ke/zufang.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clis/ke/zufang.js clis/ke/zufang.test.js
git commit -m "feat(ke): expose zufang filters and sort"
```

---

## Task 4: Validate, rebuild manifest, live smoke, finalize

**Files:** Modify `cli-manifest.json` (regenerated).

- [ ] **Step 1: Registry validation**

Run: `npx tsx src/main.ts validate ke/zufang`
Expected: PASS (0 errors). Fix any reported issue.

- [ ] **Step 2: Rebuild the manifest (arg defs changed)**

Run: `npx tsx src/build-manifest.ts`
Expected: `✅ Manifest compiled`. Then confirm only zufang changed:
`git diff --stat cli-manifest.json` should show only additions, and
`git diff cli-manifest.json | grep -E '"site"' | grep -v '"ke"'` should be empty.

- [ ] **Step 3: Full adapter test suite (no regressions)**

Run: `npm run test:adapter`
Expected: PASS, including `clis/ke/zufang-filters.test.js` and `clis/ke/zufang.test.js`.

- [ ] **Step 4: Inspect help output**

Run: `npx tsx src/main.ts ke zufang --help`
Expected: all new flags appear with their bilingual help + `choices`.

- [ ] **Step 5: Live smoke (needs logged-in Chrome + extension)**

```bash
npx tsx src/main.ts ke zufang --city sh --district pudong --rent-type whole --rooms 2 --max-price 8000 --sort newest --limit 5 -v -f json
```

Expected: a JSON array of ≤5 rentals; the `-v` URL matches what the helper builds. Open
that URL in a browser to confirm the filters/sort actually applied (整租 + 两居 + ≤8000元).
If a filter did NOT apply, a code or the order is wrong → fix the constant + its test,
re-run `npm run test:adapter`.

- [ ] **Step 6: Commit the manifest (+ any smoke fixes)**

```bash
git add cli-manifest.json clis/ke/zufang-filters.js clis/ke/zufang-filters.test.js
git commit -m "chore(ke): rebuild manifest for zufang filters and sort"
```

---

## Self-Review notes

- **Spec coverage:** rent-type/rooms/orientation/features/lease-term/floor/elevator
  (Task 2/3), `--sort` Pattern-A enum incl. query-param fallback (Task 1 Step 3 + Task 3
  Step 3 alt), `zufang-filters.js` pure separate module (Task 2), canonical-order assembly
  with rent segment as a producer (Task 2 `SEGMENT_PRODUCERS` + `rentCode`), live code
  verification + ≥2 golden URLs (Task 1), tests in `adapter` project (Task 2–4),
  backward-compat (Task 3 tests), brand/location/bands excluded (not in any task). All spec
  sections map to a task.
- **Rent kept as-is:** `rentCode` reproduces the original `rp{min}t{max}` byte-for-byte
  (including one-sided/`0` behavior); the ershoufang one-sided fix is deliberately NOT
  ported, per the spec decision.
- **Guessed vs confirmed:** every zufang code is a starting guess reconciled in Task 2
  Step 4 against Task 1; parametric tests read the tables so they stay correct regardless,
  and the two golden URLs pin real behavior.
- **Backward-compat URL note:** Task 3's `rpt8000` expectation assumes the original
  `rp{min}t{max}` with empty min — identical to the pre-change output for `--max-price`
  only; verify this exact string against the original code during Task 3.
