# Expand `ke ershoufang` Filters & Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Beike listing filters (朝向/楼层/楼龄/装修/电梯/房源特色/用途 + 面积区间) and result sort (`--sort`) to `opencli ke ershoufang`, encoded as URL path code segments.

**Architecture:** A new pure module `clis/ke/filters.js` owns the keyword→Beike-code mapping tables and a `buildErshoufangFilterPath(kwargs)` function that emits all active codes in Beike's canonical order. `clis/ke/ershoufang.js` gains the new arg definitions and delegates URL-segment assembly to that helper; its DOM scraping is unchanged. Exact Beike codes are confirmed against the live site first.

**Tech Stack:** Node ESM JS adapters (`@jackwener/opencli/registry`, `errors`), vitest (`adapter` project), `opencli browser` for live verification.

Spec: `docs/superpowers/specs/2026-06-15-ke-ershoufang-filters-sort-design.md`

---

## File Structure

- **Create** `clis/ke/filters.js` — mapping tables + `buildErshoufangFilterPath`. Pure, browser-free.
- **Create** `clis/ke/filters.test.js` — unit tests for the helper (vitest `adapter` project).
- **Create** `clis/ke/ershoufang.test.js` — command-level URL assembly + backward-compat tests.
- **Modify** `clis/ke/ershoufang.js` — add arg defs, import helper, replace inline URL assembly.

`clis/ke/utils.js` (gotoKe, cityUrl) is reused unchanged.

---

## Task 1: Verify Beike filter/sort codes & canonical order (live)

This task confirms every `⚠️` code in the spec and the order codes are concatenated in.
It needs a Chrome logged into ke.com with the OpenCLI extension (the `ershoufang`
strategy is `COOKIE`). If you cannot run a live browser, STOP and hand this task to
someone who can — the rest of the plan depends on its output.

**Files:** none yet (produces a confirmed code table you paste into Task 2).

- [ ] **Step 1: Open the reference page**

Run (foreground so you can watch the URL bar):

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser open "https://hz.ke.com/ershoufang/xihuqu4/"
```

Expected: a 西湖区 二手房 list page loads. If it shows a captcha/login wall, log in /
solve it in that window first (the command shares your live session).

- [ ] **Step 2: Toggle each in-scope filter, record the code it adds to the URL**

In that browser window, click ONE option at a time and read the path segment that
appears (e.g. clicking 毛坯 turns `/xihuqu4/` into `/xihuqu4/de3/`). Record into a
scratch table. Cover every value the spec lists:

- 朝向: 南北 / 朝南 / 朝东 / 朝北 / 朝西  → `f?` codes
- 楼层: 低楼层 / 中楼层 / 高楼层  → `lc?` codes
- 楼龄: 5年以内 / 10年以内 / 15年以内 / 20年以内 / 20年以上  → `y?` codes
- 装修: 精装修 / 普通装修 / 毛坯房  → `de1/de2/de3` (de3 already confirmed)
- 电梯: 有电梯 / 无电梯  → `ie?` codes
- 房源特色: 必看好房 / 满五年 / 满两年 / 近地铁 / VR房源 / 7日新上 / 随时看房  → per-feature codes
- 用途: 普通住宅 / 商业类 / 别墅 / 四合院 / 车位 / 其他  → usage codes
- 建筑面积 自定义: type a min & max into the 建筑面积 custom box, Confirm → record the
  custom prefix (expected `ba{min}ea{max}`).

- [ ] **Step 3: Record the sort codes**

Click each sort tab and read the segment:
默认排序 (none) / 最新发布 (`co32` already confirmed) / 总价↑ / 总价↓ / 房屋单价↑ /
房屋单价↓ / 面积↑ / 面积↓  → `co??` codes.

- [ ] **Step 4: Establish canonical order**

Select 2–3 filters + a sort at once and read the full segment. Note the LEFT-TO-RIGHT
order Beike emits prefixes in (known anchors: `co` … `de` … `l` … `p`). Write down the
full relative order of: `co`, features, `f`, `lc`, `y`, `de`, `ie`, usage, `l`, `p`,
`ba/ea`.

- [ ] **Step 5: Spot-check city stability**

Repeat Steps 2–4 on one other city for ~3 of the enums:

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser open "https://bj.ke.com/ershoufang/"
```

Expected: in-scope enum codes match hz (price bands may differ — out of scope).

- [ ] **Step 6: Close the window**

```bash
npx tsx src/main.ts browser close
```

**Output of this task:** a confirmed table mapping each English keyword → Beike code,
plus the canonical prefix order. You will paste these values into Task 2. Where a guessed
value in Task 2 below matches your finding, keep it; where it differs, use YOUR value and
update the matching test expectation in the same step.

---

## Task 2: Create the `filters.js` helper (TDD)

**Files:**
- Create: `clis/ke/filters.js`
- Test: `clis/ke/filters.test.js`

- [ ] **Step 1: Write the failing tests**

Create `clis/ke/filters.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  buildErshoufangFilterPath,
  ORIENTATION, FLOOR, AGE, DECORATION, ELEVATOR, FEATURES, USAGE, SORT,
} from './filters.js';

describe('buildErshoufangFilterPath', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildErshoufangFilterPath({})).toBe('');
  });

  // ── Golden tests on confirmed anchors (de3 / l3 / p / co32) ──
  it('encodes rooms as l{n}', () => {
    expect(buildErshoufangFilterPath({ rooms: 3 })).toBe('l3');
  });
  it('encodes decoration=rough as de3', () => {
    expect(buildErshoufangFilterPath({ decoration: 'rough' })).toBe('de3');
  });
  it('encodes sort=newest as co32', () => {
    expect(buildErshoufangFilterPath({ sort: 'newest' })).toBe('co32');
  });
  it('keeps the existing price encoding p{min}t{max}', () => {
    expect(buildErshoufangFilterPath({ 'min-price': 100, 'max-price': 300 })).toBe('p100t300');
  });
  it('encodes area range as ba{min}ea{max}', () => {
    expect(buildErshoufangFilterPath({ 'min-area': 70, 'max-area': 120 })).toBe('ba70ea120');
  });

  // ── Parametric tests: derive expected from the tables (robust to verified codes) ──
  it('maps each single-value enum through its own table', () => {
    expect(buildErshoufangFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildErshoufangFilterPath({ floor: 'high' })).toBe(FLOOR.high);
    expect(buildErshoufangFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildErshoufangFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildErshoufangFilterPath({ usage: 'villa' })).toBe(USAGE.villa);
    expect(buildErshoufangFilterPath({ sort: 'total-price-asc' })).toBe(SORT['total-price-asc']);
  });

  it('splits --features and emits feature codes in table-definition order', () => {
    // input order reversed; output must follow FEATURES key order
    const expected = FEATURES['near-subway'] + FEATURES.vr;
    expect(buildErshoufangFilterPath({ features: 'vr,near-subway' })).toBe(expected);
  });
  it('throws ArgumentError on an unknown feature keyword', () => {
    expect(() => buildErshoufangFilterPath({ features: 'bogus' })).toThrow(/unknown/i);
  });
  it('trims and ignores blank feature entries', () => {
    expect(buildErshoufangFilterPath({ features: ' vr , ' })).toBe(FEATURES.vr);
  });

  // ── Canonical order across categories (uses only confirmed anchors) ──
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const out = buildErshoufangFilterPath({ rooms: 3, decoration: 'rough', sort: 'newest' });
    expect(out).toBe('co32de3l3');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project adapter clis/ke/filters.test.js`
Expected: FAIL — `Failed to resolve import "./filters.js"`.

- [ ] **Step 3: Implement `clis/ke/filters.js`**

Paste the codes confirmed in Task 1 into the tables below. The values shown are best
guesses to be CONFIRMED/CORRECTED in Step 4 — `de3`, `l{n}`, `co32`, and the
`p{min}t{max}` price form are already confirmed.

```js
import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike URL code. Values confirmed against the live site (Task 1).
export const ORIENTATION = {
  'south-north': 'f5', south: 'f2', east: 'f1', north: 'f4', west: 'f3',
};
export const FLOOR = { low: 'lc1', mid: 'lc2', high: 'lc3' };
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
export const DECORATION = { fine: 'de1', simple: 'de2', rough: 'de3' };
export const ELEVATOR = { yes: 'ie1', no: 'ie2' };
// 房源特色 (multi-select). Iteration order here IS the emit order.
export const FEATURES = {
  'must-see': 'ng1',
  'five-years': 'mw1',
  'two-years': 'mw2',
  'near-subway': 'nb1',
  vr: 'vr1',
  'new-7d': 'nd1',
  'anytime-view': 'av1',
};
export const USAGE = {
  residential: 'sf1', commercial: 'sf2', villa: 'sf3',
  courtyard: 'sf4', parking: 'sf5', other: 'sf6',
};
export const SORT = {
  newest: 'co32',
  'total-price-asc': 'co21',
  'total-price-desc': 'co22',
  'unit-price-asc': 'co41',
  'unit-price-desc': 'co42',
  'area-asc': 'co51',
  'area-desc': 'co52',
};

function lookup(table, key) {
  if (key === undefined || key === null || key === '') return '';
  return table[String(key)] || '';
}

function roomsCode(rooms) {
  return rooms ? `l${rooms}` : '';
}

function priceCode(kwargs) {
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!min && !max) return '';
  return `p${min || ''}t${max || ''}`;
}

function areaCode(kwargs) {
  const min = kwargs['min-area'];
  const max = kwargs['max-area'];
  if (!min && !max) return '';
  return `ba${min || ''}ea${max || ''}`;
}

function featuresCode(raw) {
  if (!raw) return '';
  const requested = new Set(
    String(raw).split(',').map((s) => s.trim()).filter(Boolean),
  );
  for (const key of requested) {
    if (!FEATURES[key]) {
      throw new ArgumentError(
        `unknown --features value: "${key}"`,
        `Allowed: ${Object.keys(FEATURES).join(', ')}`,
      );
    }
  }
  // emit in table-definition order, not user order
  return Object.keys(FEATURES).filter((k) => requested.has(k)).map((k) => FEATURES[k]).join('');
}

// Canonical left-to-right order Beike concatenates prefixes in (confirmed in Task 1).
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => featuresCode(k.features),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(AGE, k.age),
  (k) => lookup(DECORATION, k.decoration),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => lookup(USAGE, k.usage),
  (k) => roomsCode(k.rooms),
  (k) => priceCode(k),
  (k) => areaCode(k),
];

/**
 * Build the Beike filter/sort code segment for /ershoufang/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildErshoufangFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
```

- [ ] **Step 4: Reconcile with Task 1 findings**

Compare each table value and the `SEGMENT_PRODUCERS` order against your Task 1 recording.
For every mismatch: change the table/order value AND update the corresponding test
expectation (the golden tests `de3`/`l3`/`co32`/`p100t300`/`ba70ea120` and the
`co32de3l3` order test). The parametric tests need no change — they read the tables.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project adapter clis/ke/filters.test.js`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add clis/ke/filters.js clis/ke/filters.test.js
git commit -m "feat(ke): add ershoufang filter/sort code helper"
```

---

## Task 3: Wire the helper into `ershoufang.js` (TDD)

**Files:**
- Modify: `clis/ke/ershoufang.js`
- Test: `clis/ke/ershoufang.test.js`

- [ ] **Step 1: Write the failing command tests**

Create `clis/ke/ershoufang.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ershoufang.js';

const cmd = () => getRegistry().get('ke/ershoufang');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    // readPageState + the list scrape both call evaluate; '' state => not blocked
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/ershoufang command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['orientation', 'floor', 'age', 'decoration', 'elevator',
                      'features', 'usage', 'min-area', 'max-area', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toContain('total-price-desc');
  });

  it('builds a URL with filters + sort in canonical order', async () => {
    const page = mockPage();
    await cmd().func(page, {
      city: 'hz', district: 'xihuqu4', rooms: 3, decoration: 'rough', sort: 'newest', limit: 10,
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://hz.ke.com/ershoufang/xihuqu4/co32de3l3/', expect.anything(),
    );
  });

  it('backward-compat: rooms only', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', rooms: 2, limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/ershoufang/l2/', expect.anything(),
    );
  });

  it('no district, no filters', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/ershoufang/', expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project adapter clis/ke/ershoufang.test.js`
Expected: FAIL — the new args are missing and the combined URL is wrong (old code emits
price before rooms / has no filter support).

- [ ] **Step 3: Update `clis/ke/ershoufang.js`**

Add the import near the top (after the existing imports):

```js
import { buildErshoufangFilterPath } from './filters.js';
```

Replace the `args: [ ... ]` array with:

```js
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, tianhe, xihuqu4' },
        { name: 'min-price', type: 'int', help: '最低总价（万元）' },
        { name: 'max-price', type: 'int', help: '最高总价（万元）' },
        { name: 'min-area', type: 'int', help: '最小建筑面积（㎡）' },
        { name: 'max-area', type: 'int', help: '最大建筑面积（㎡）' },
        { name: 'rooms', type: 'int', help: '几居室 (1-5)' },
        { name: 'orientation', choices: ['south-north', 'south', 'east', 'north', 'west'], help: '朝向：south-north(南北)/south(朝南)/east(朝东)/north(朝北)/west(朝西)' },
        { name: 'floor', choices: ['low', 'mid', 'high'], help: '楼层：low(低)/mid(中)/high(高)' },
        { name: 'age', choices: ['5', '10', '15', '20', '20+'], help: '楼龄：5/10/15/20 年以内，20+ 为 20 年以上' },
        { name: 'decoration', choices: ['fine', 'simple', 'rough'], help: '装修：fine(精装)/simple(普通)/rough(毛坯)' },
        { name: 'elevator', choices: ['yes', 'no'], help: '电梯：yes(有)/no(无)' },
        { name: 'features', help: '房源特色，逗号分隔多选：must-see,five-years,two-years,near-subway,vr,new-7d,anytime-view' },
        { name: 'usage', choices: ['residential', 'commercial', 'villa', 'courtyard', 'parking', 'other'], help: '用途：residential(普通住宅)/commercial(商业类)/villa(别墅)/courtyard(四合院)/parking(车位)/other(其他)' },
        { name: 'sort', choices: ['newest', 'total-price-asc', 'total-price-desc', 'unit-price-asc', 'unit-price-desc', 'area-asc', 'area-desc'], help: '排序：newest(最新发布)/total-price-asc|desc(总价)/unit-price-asc|desc(单价)/area-asc|desc(面积)' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
```

Replace the URL-assembly block (the `let path` / `priceParts` / `roomParts` / `filters`
/ `url` lines, currently `clis/ke/ershoufang.js:26-44`) with:

```js
        let path = '/ershoufang/';
        if (kwargs.district) {
            path = `/ershoufang/${kwargs.district}/`;
        }

        const filters = buildErshoufangFilterPath(kwargs);
        const url = base + path + (filters ? filters + '/' : '');
```

Leave everything else (the `gotoKe`, `page.evaluate` scrape, `.slice(0, limit)`)
unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project adapter clis/ke/ershoufang.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clis/ke/ershoufang.js clis/ke/ershoufang.test.js
git commit -m "feat(ke): expose ershoufang filters and sort"
```

---

## Task 4: Validate, live smoke, finalize

**Files:** none (verification + docs only).

- [ ] **Step 1: Registry validation**

Run: `npx tsx src/main.ts validate ke/ershoufang`
Expected: passes (no duplicate args, valid description/domain). Fix any reported issue.

- [ ] **Step 2: Full adapter test suite (no regressions)**

Run: `npm run test:adapter`
Expected: PASS, including the new `clis/ke/filters.test.js` and
`clis/ke/ershoufang.test.js`.

- [ ] **Step 3: Inspect the help output**

Run: `npx tsx src/main.ts ke ershoufang --help`
Expected: all new flags appear with their bilingual help strings.

- [ ] **Step 4: Live smoke (needs logged-in Chrome + extension)**

Run a real multi-filter query and confirm it returns filtered rows:

```bash
npx tsx src/main.ts ke ershoufang --city hz --district xihuqu4 --rooms 3 --decoration rough --sort newest --limit 5 -f json
```

Expected: a JSON array of ≤5 listings. Open the same URL the command built (visible with
`-v`) in a browser to confirm the filters/sort actually applied. If a filter did NOT
apply, a code or the canonical order is wrong → return to Task 1/Task 2, fix the
constant + its test, re-run `npm run test:adapter`.

- [ ] **Step 5: Final commit (only if Step 4 required fixes)**

```bash
git add clis/ke/filters.js clis/ke/filters.test.js clis/ke/ershoufang.js clis/ke/ershoufang.test.js
git commit -m "fix(ke): correct ershoufang filter codes per live verification"
```

---

## Self-Review notes

- **Spec coverage:** orientation/floor/age/decoration/elevator/features/usage (Task 2/3),
  area range min/max (Task 2/3), `--sort` Pattern-A enum (Task 2/3), `filters.js` pure
  module (Task 2), canonical-order assembly (Task 2 `SEGMENT_PRODUCERS`), live code
  verification (Task 1), tests in `adapter` project (Task 2–4), backward-compat
  (Task 3 tests). All spec sections map to a task.
- **Known-vs-guessed codes:** only `de3`, `l{n}`, `co32`, and the `p{min}t{max}` price
  form are pre-confirmed; every other code value is a guess explicitly reconciled in
  Task 2 Step 4 against Task 1, with parametric tests that stay correct regardless.
- **Order fix:** the new helper emits `l`(rooms) before `p`(price), matching Beike
  anchors (`de3l3p1`); the prior inline code emitted price before rooms. Backward-compat
  tests cover rooms-only and price-only (unaffected); combined rooms+price now produces
  the Beike-correct order.
