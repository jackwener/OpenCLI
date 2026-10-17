# Expand `ke chengjiao` Filters & Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Beike deal-record filters (房型/建筑面积/朝向/楼层/楼龄/装修/用途/电梯) and sort (`--sort` by 总价/单价/面积) to `opencli ke chengjiao`, encoded as URL path code segments on `{city}.ke.com/chengjiao`.

**Architecture:** A new pure module `clis/ke/chengjiao-filters.js` (separate, independently verified — NOT importing ershoufang's `filters.js`, per the architecture decision) owns the keyword→code tables and `buildChengjiaoFilterPath(kwargs)`, which emits active codes in canonical order. `clis/ke/chengjiao.js` gains the arg defs and delegates URL-segment assembly; its DOM scraping is unchanged. Codes confirmed live first.

**Tech Stack:** Node ESM JS adapters (`@jackwener/opencli/registry`, `errors`), vitest (`adapter` project), `opencli browser` for live verification.

Spec: `docs/superpowers/specs/2026-06-16-ke-chengjiao-filters-sort-design.md`

---

## File Structure

- **Create** `clis/ke/chengjiao-filters.js` — tables + `buildChengjiaoFilterPath`. Pure.
- **Create** `clis/ke/chengjiao-filters.test.js` — unit + live-golden tests.
- **Create** `clis/ke/chengjiao.test.js` — command URL assembly + backward-compat tests.
- **Modify** `clis/ke/chengjiao.js` — add arg defs, import helper, replace URL assembly.

`clis/ke/utils.js` (gotoKe, cityUrl) reused unchanged. `clis/ke/filters.js` (ershoufang) NOT touched.

---

## Task 1: Verify chengjiao codes, area prefix, sort & order (live)

The chengjiao filter panel is JS-driven (not `<a href>`), so verify by constructing
candidate URLs and reading `document.title`. PACE requests — a captcha appears after ~5
rapid hits; close the session between batches and re-open. Needs a logged-in Chrome + extension.

- [ ] **Step 1: Confirm single-filter codes via title**

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser cj open "https://sh.ke.com/chengjiao/xuhui/"
# batch of <=4, then re-open between batches:
for u in l3 sf1 de3 f100500000003; do
  npx tsx src/main.ts browser cj open "https://sh.ke.com/chengjiao/xuhui/$u/" >/dev/null 2>&1
  npx tsx src/main.ts browser cj eval 'document.title'
done
```

Expected: `l3`→三室, `sf1`→普通住宅, `de3`→毛坯 (already confirmed). Determine 朝向 code
(try `f100500000003` zufang-style and `f2` ershoufang-style — see which title shows 朝南).
Then in further small batches confirm: 楼层 (低/中/高 — try `lc1`/`lc2`/`lc3` AND the long
`lc200500000003` zufang form), 楼龄 (`y1`–`y5`), 装修 (`de1`/`de2`), 用途 (`sf2`–`sf6`),
电梯 (有=`ie2`/无=`ie1`? confirm).

- [ ] **Step 2: Confirm the area custom-range prefix + one-sided rule**

```bash
for u in ba70ea90 ba70ea ba0ea90 baea90; do
  npx tsx src/main.ts browser cj open "https://sh.ke.com/chengjiao/xuhui/$u/" >/dev/null 2>&1
  npx tsx src/main.ts browser cj eval 'document.title' ; done
```

Expected (mirror ershoufang): `ba70ea90`→70-90㎡, `ba70ea`→70㎡以上, `ba0ea90`→90㎡以下,
`baea90`→ignored. Record the prefix and confirm max-only needs min=0.

- [ ] **Step 3: Confirm sort codes + direction**

Probe sort path segments and read the first record's price/area to infer asc/desc. Try the
ershoufang `co` codes: `co21`/`co22` (总价), `co41`/`co42` (单价), `co11`/`co12` (面积). For
each, read the first card's deal price / unit price / area to confirm which is asc vs desc.

```bash
for u in co21 co22 co41 co42 co11 co12; do
  npx tsx src/main.ts browser cj open "https://sh.ke.com/chengjiao/xuhui/$u/" >/dev/null 2>&1
  npx tsx src/main.ts browser cj eval '(() => { const c=document.querySelector(".listContent li, .sellListContent li"); const tp=c&&c.querySelector(".totalPrice span"); const up=c&&c.querySelector(".unitPrice span"); const a=c&&c.querySelector(".houseInfo"); return "tp="+(tp?tp.textContent.trim():"?")+" up="+(up?up.textContent.trim():"?")+" info="+(a?a.textContent.replace(/\s+/g," ").trim().slice(0,40):"?"); })()'
done
```

- [ ] **Step 4: Canonical order + city spot-check**

Build a multi-filter URL (e.g. `co21de3l3` or with area) and read the title to confirm all
apply. Construct one URL in your intended producer order and verify it filters. Spot-check
`bj.ke.com/chengjiao/` for 楼龄 + 用途 codes. Close the session.

```bash
npx tsx src/main.ts browser cj close
```

- [ ] **Step 5: Write the captured URL as a golden test**

Create `clis/ke/chengjiao-filters.test.js` with the import + ≥1 real captured multi-filter
URL as a golden assertion (skeleton; replace with real kwargs/segment from Step 4):

```js
import { describe, expect, it } from 'vitest';
import {
  buildChengjiaoFilterPath, ORIENTATION, FLOOR, AGE, DECORATION, ELEVATOR, USAGE, SORT,
} from './chengjiao-filters.js';

describe('buildChengjiaoFilterPath — live golden URL', () => {
  it('matches a captured multi-filter URL', () => {
    expect(buildChengjiaoFilterPath({
      rooms: 3, decoration: 'rough', sort: 'total-price-asc',
    })).toBe('REPLACE_WITH_CAPTURED_SEGMENT');
  });
});
```

**Output:** confirmed codes (notes for Task 2) + a golden test with a real URL.

---

## Task 2: Create the `chengjiao-filters.js` helper (TDD)

**Files:**
- Create: `clis/ke/chengjiao-filters.js`
- Test: `clis/ke/chengjiao-filters.test.js` (extend the golden file from Task 1)

- [ ] **Step 1: Add behavior tests**

Append to `clis/ke/chengjiao-filters.test.js`:

```js
describe('buildChengjiaoFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildChengjiaoFilterPath({})).toBe('');
  });
  it('encodes rooms as l{n}', () => {
    expect(buildChengjiaoFilterPath({ rooms: 3 })).toBe('l3');
  });
  it('maps each single-value enum through its own table', () => {
    expect(buildChengjiaoFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildChengjiaoFilterPath({ floor: 'high' })).toBe(FLOOR.high);
    expect(buildChengjiaoFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildChengjiaoFilterPath({ decoration: 'rough' })).toBe(DECORATION.rough);
    expect(buildChengjiaoFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildChengjiaoFilterPath({ usage: 'villa' })).toBe(USAGE.villa);
    expect(buildChengjiaoFilterPath({ sort: 'total-price-asc' })).toBe(SORT['total-price-asc']);
  });
  it('encodes a two-sided area range', () => {
    expect(buildChengjiaoFilterPath({ 'min-area': 70, 'max-area': 90 })).toBe('ba70ea90');
  });
  it('encodes a lower-bound-only area as ba{min}ea', () => {
    expect(buildChengjiaoFilterPath({ 'min-area': 70 })).toBe('ba70ea');
  });
  it('defaults min to 0 for an upper-bound-only area', () => {
    expect(buildChengjiaoFilterPath({ 'max-area': 90 })).toBe('ba0ea90');
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildChengjiaoFilterPath({ rooms: 3, decoration: 'rough', sort: 'total-price-asc' });
    const b = buildChengjiaoFilterPath({ sort: 'total-price-asc', decoration: 'rough', rooms: 3 });
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project adapter clis/ke/chengjiao-filters.test.js`
Expected: FAIL — `Failed to resolve import "./chengjiao-filters.js"`.

- [ ] **Step 3: Implement `clis/ke/chengjiao-filters.js`**

Paste the codes confirmed in Task 1 (values below are starting guesses matching ershoufang
— REPLACE each with your Task 1 capture):

```js
import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike code. All values verified live against sh.ke.com/chengjiao (Task 1).
export const ORIENTATION = {
  'south-north': 'f5', south: 'f2', east: 'f1', north: 'f4', west: 'f3',
};
export const FLOOR = { low: 'lc1', mid: 'lc2', high: 'lc3' };
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
export const DECORATION = { fine: 'de1', simple: 'de2', rough: 'de3' };
export const ELEVATOR = { yes: 'ie2', no: 'ie1' };
export const USAGE = {
  residential: 'sf1', commercial: 'sf2', villa: 'sf3',
  courtyard: 'sf4', parking: 'sf5', other: 'sf6',
};
export const SORT = {
  'total-price-asc': 'co21', 'total-price-desc': 'co22',
  'unit-price-asc': 'co41', 'unit-price-desc': 'co42',
  'area-asc': 'co11', 'area-desc': 'co12',
};

function present(v) {
  return v !== undefined && v !== null && v !== '';
}
function lookup(table, key) {
  if (!present(key)) return '';
  return table[String(key)] || '';
}
function roomsCode(rooms) {
  return present(rooms) ? `l${rooms}` : '';
}
function areaCode(kwargs) {
  const min = kwargs['min-area'];
  const max = kwargs['max-area'];
  if (!present(min) && !present(max)) return '';
  // max-only needs an explicit min (verified live); default lower bound to 0.
  const lo = present(min) ? min : 0;
  return `ba${lo}ea${present(max) ? max : ''}`;
}

// Canonical order confirmed in Task 1 (chengjiao has no features/price vs ershoufang).
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(USAGE, k.usage),
  (k) => lookup(DECORATION, k.decoration),
  (k) => lookup(AGE, k.age),
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => areaCode(k),
  (k) => roomsCode(k.rooms),
];

/**
 * Build the Beike chengjiao filter/sort code segment for /chengjiao/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildChengjiaoFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
```

(The `ArgumentError` import is kept for parity with the other helpers even though chengjiao
has no multi-select feature arg; if unused after Task 1, remove it to satisfy lint.)

- [ ] **Step 4: Reconcile with Task 1 findings**

Replace every guessed value and reorder `SEGMENT_PRODUCERS` to match Task 1. Replace
`REPLACE_WITH_CAPTURED_SEGMENT` in the golden test, and the `l3`/`ba70ea90`/`ba0ea90`/
`co...`-derived expectations if any differ. Parametric tests read the tables — no change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project adapter clis/ke/chengjiao-filters.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add clis/ke/chengjiao-filters.js clis/ke/chengjiao-filters.test.js
git commit -m "feat(ke): add chengjiao filter/sort code helper"
```

---

## Task 3: Wire the helper into `chengjiao.js` (TDD)

**Files:**
- Modify: `clis/ke/chengjiao.js`
- Test: `clis/ke/chengjiao.test.js`

- [ ] **Step 1: Write the failing command tests**

Create `clis/ke/chengjiao.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './chengjiao.js';
import { buildChengjiaoFilterPath } from './chengjiao-filters.js';

const cmd = () => getRegistry().get('ke/chengjiao');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/chengjiao command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['rooms', 'min-area', 'max-area', 'orientation', 'floor',
                      'age', 'decoration', 'usage', 'elevator', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toContain('total-price-desc');
    // chengjiao sort must NOT offer 'newest'
    expect(sortArg.choices).not.toContain('newest');
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'xuhui', rooms: 3, decoration: 'rough', limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildChengjiaoFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.ke.com/chengjiao/xuhui/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: no filters, with district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', district: 'haidian', limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/chengjiao/haidian/', expect.anything(),
    );
  });

  it('backward-compat: no district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/chengjiao/', expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project adapter clis/ke/chengjiao.test.js`
Expected: FAIL — new args missing.

- [ ] **Step 3: Update `clis/ke/chengjiao.js`**

Add the import after the existing imports:

```js
import { buildChengjiaoFilterPath } from './chengjiao-filters.js';
```

Replace the `args: [ ... ]` array with:

```js
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, xuhui' },
        { name: 'rooms', type: 'int', help: '几室 (1-5)' },
        { name: 'min-area', type: 'int', help: '最小建筑面积（㎡）' },
        { name: 'max-area', type: 'int', help: '最大建筑面积（㎡）' },
        { name: 'orientation', choices: ['south-north', 'south', 'east', 'north', 'west'], help: '朝向：south-north(南北)/south(朝南)/east(朝东)/north(朝北)/west(朝西)' },
        { name: 'floor', choices: ['low', 'mid', 'high'], help: '楼层：low(低)/mid(中)/high(高)' },
        { name: 'age', choices: ['5', '10', '15', '20', '20+'], help: '楼龄：5/10/15/20 年以内，20+ 为 20 年以上' },
        { name: 'decoration', choices: ['fine', 'simple', 'rough'], help: '装修：fine(精装)/simple(普通)/rough(毛坯)' },
        { name: 'usage', choices: ['residential', 'commercial', 'villa', 'courtyard', 'parking', 'other'], help: '用途：residential(普通住宅)/commercial(商业类)/villa(别墅)/courtyard(四合院)/parking(车位)/other(其他)' },
        { name: 'elevator', choices: ['yes', 'no'], help: '电梯：yes(有)/no(无)' },
        { name: 'sort', choices: ['total-price-asc', 'total-price-desc', 'unit-price-asc', 'unit-price-desc', 'area-asc', 'area-desc'], help: '排序：total-price-asc|desc(总价)/unit-price-asc|desc(房屋单价)/area-asc|desc(面积)' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
```

Replace the URL-assembly block (the `let path` / `if (kwargs.district)` lines and the
`await gotoKe(page, base + path)` call — currently `clis/ke/chengjiao.js:23-28`) with:

```js
        let path = '/chengjiao/';
        if (kwargs.district) {
            path = `/chengjiao/${kwargs.district}/`;
        }

        const filters = buildChengjiaoFilterPath(kwargs);
        await gotoKe(page, base + path + (filters ? filters + '/' : ''));
```

Leave the `page.evaluate` scrape and `.slice(0, limit)` unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project adapter clis/ke/chengjiao.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clis/ke/chengjiao.js clis/ke/chengjiao.test.js
git commit -m "feat(ke): expose chengjiao filters and sort"
```

---

## Task 4: Validate, rebuild manifest, live smoke, finalize

**Files:** Modify `cli-manifest.json` (regenerated).

- [ ] **Step 1: Registry validation**

Run: `npx tsx src/main.ts validate ke/chengjiao`
Expected: PASS (0 errors).

- [ ] **Step 2: Rebuild the manifest**

Run: `npx tsx src/build-manifest.ts`
Expected: `✅ Manifest compiled`. Confirm only chengjiao changed:
`git diff cli-manifest.json | grep -E '"site"' | grep -v '"ke"'` should be empty.

- [ ] **Step 3: Full adapter test suite**

Run: `npm run test:adapter`
Expected: PASS, including the two new `clis/ke/chengjiao*.test.js` files.

- [ ] **Step 4: Inspect help output**

Run: `npx tsx src/main.ts ke chengjiao --help`
Expected: all new flags appear with help + `choices`; `--sort` has no `newest`.

- [ ] **Step 5: Live smoke (needs logged-in Chrome + extension)**

```bash
npx tsx src/main.ts ke chengjiao --city bj --district haidian --rooms 3 --sort total-price-desc --limit 5 -v -f json
```

Expected: a JSON array of ≤5 deal records, all 3室, ordered by descending deal price; the
`-v` URL matches the helper output. If a filter didn't apply, fix the constant + its test
and re-run `npm run test:adapter`.

- [ ] **Step 6: Commit the manifest (+ any smoke fixes)**

```bash
git add cli-manifest.json clis/ke/chengjiao-filters.js clis/ke/chengjiao-filters.test.js
git commit -m "chore(ke): rebuild manifest for chengjiao filters and sort"
```

---

## Self-Review notes

- **Spec coverage:** rooms/area-range/orientation/floor/age/decoration/usage/elevator
  (Task 2/3), `--sort` total-price/unit-price/area asc-desc with NO newest (Task 2/3 +
  the explicit `not.toContain('newest')` test), separate pure module (Task 2), canonical
  order (Task 2 `SEGMENT_PRODUCERS`), live verification + golden URL (Task 1), tests in
  `adapter` project (Task 2–4), backward-compat (Task 3 tests), no features / no price /
  bands / 供暖 / location excluded (not in any task). All spec sections map to a task.
- **area one-sided:** handled in `areaCode` (max-only → min 0) per the verified rule.
- **Independent module:** `chengjiao-filters.js` does not import `filters.js`; codes
  verified independently on the chengjiao endpoint (Task 1), even though l3/sf1/de3 match.
- **Guessed vs confirmed:** l3/sf1/de3 pre-confirmed; every other code (orientation, floor,
  age de1/de2, usage sf2–sf6, elevator, sort, area prefix) is a starting guess reconciled
  in Task 2 Step 4 against Task 1; the golden URL pins real behavior. Floor is verified
  properly here (ershoufang's floor codes were never confirmed).
