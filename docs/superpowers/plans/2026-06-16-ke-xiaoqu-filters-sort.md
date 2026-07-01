# Expand `ke xiaoqu` Filters & Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Beike community filters (均价 custom range, 楼龄, 近地铁) and sort (`--sort` by 小区均价) to `opencli ke xiaoqu`, encoded as URL path code segments on `{city}.ke.com/xiaoqu`.

**Architecture:** A new pure module `clis/ke/xiaoqu-filters.js` owns the keyword→code tables and `buildXiaoquFilterPath(kwargs)`, which emits active codes (avg-price range, age, near-subway, sort) in canonical order. `clis/ke/xiaoqu.js` gains the arg defs and delegates URL-segment assembly to the helper; its DOM scraping is unchanged. All codes are confirmed live first.

**Tech Stack:** Node ESM JS adapters (`@jackwener/opencli/registry`, `errors`), vitest (`adapter` project), `opencli browser` for live verification.

Spec: `docs/superpowers/specs/2026-06-16-ke-xiaoqu-filters-sort-design.md`

---

## File Structure

- **Create** `clis/ke/xiaoqu-filters.js` — tables + `buildXiaoquFilterPath`. Pure, browser-free.
- **Create** `clis/ke/xiaoqu-filters.test.js` — unit + live-golden tests (vitest `adapter`).
- **Create** `clis/ke/xiaoqu.test.js` — command-level URL assembly + backward-compat tests.
- **Modify** `clis/ke/xiaoqu.js` — add arg defs, import helper, replace inline URL assembly.

`clis/ke/utils.js` (gotoKe, cityUrl) reused unchanged. `clis/ke/filters.js` (ershoufang) NOT touched.

---

## Task 1: Verify xiaoqu codes, avg-price prefix & order (live)

Needs a Chrome logged into ke.com with the OpenCLI extension. Output: confirmed codes +
≥1 captured golden URL written into `clis/ke/xiaoqu-filters.test.js`.

- [ ] **Step 1: Open the reference page and read filter hrefs**

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser xiaoqu open "https://sh.ke.com/xiaoqu/xuhui/"
npx tsx src/main.ts browser xiaoqu eval '(() => {
  const out=[];
  document.querySelectorAll("a[href*=\"/xiaoqu/\"]").forEach(a=>{
    const t=(a.textContent||"").trim();
    const seg=(a.getAttribute("href")||"").replace(/^.*\/xiaoqu\//,"").replace(/\/.*$/,"");
    if(t && t.length<=8 && /[0-9]/.test(seg) && seg.length<30) out.push(t+" => "+seg);
  });
  return [...new Set(out)].join("\n");
})()'
```

Expected: lines like `5年以内 => xuhui/y1`, `近地铁 => xuhui/<code>`, plus 均价 bands.
Record: 楼龄 (5/10/15/20年以内, 20年以上), 近地铁, and the 排序 (小区均价) code.

- [ ] **Step 2: Determine the avg-price custom-range prefix + one-sided behavior**

Type values into the 均价 custom box (or probe URLs) and read the path. Confirm the
two-sided prefix, then test min-only and max-only and read the page title to see which
applies (mirrors the ershoufang area check: `ba70ea` worked, `baea120` needed `ba0ea120`).
Record the exact prefix and the one-sided rule.

```bash
# control + one-sided probes (replace PFX with the confirmed prefix; read title each time)
for u in "PFX1t2" "PFX1t" "PFXt2" "PFX0t2"; do
  npx tsx src/main.ts browser xiaoqu open "https://sh.ke.com/xiaoqu/xuhui/$u/" >/dev/null 2>&1
  npx tsx src/main.ts browser xiaoqu eval 'document.title' ; done
```

- [ ] **Step 3: Confirm sort asc/desc + canonical order**

Click 小区均价 sort (and again to toggle); read the `co` code and infer direction from the
first community's avg price. Read a 2-filter href (e.g. with 近地铁 active, read 楼龄's href)
to fix the canonical order.

- [ ] **Step 4: Spot-check one other city**

```bash
OPENCLI_WINDOW=foreground npx tsx src/main.ts browser xiaoqu open "https://bj.ke.com/xiaoqu/"
```

Re-check 楼龄 + 近地铁 codes; confirm they match sh.

- [ ] **Step 5: Write the captured URL as a golden test + close**

Create `clis/ke/xiaoqu-filters.test.js` with the import and ≥1 real captured multi-filter
URL as a golden assertion (skeleton; replace with real values):

```js
import { describe, expect, it } from 'vitest';
import { buildXiaoquFilterPath, AGE, SORT } from './xiaoqu-filters.js';

describe('buildXiaoquFilterPath — live golden URL', () => {
  it('matches a captured multi-filter URL', () => {
    expect(buildXiaoquFilterPath({
      age: '10', 'near-subway': true, sort: 'avg-price-asc',
    })).toBe('REPLACE_WITH_CAPTURED_SEGMENT');
  });
});
```

```bash
npx tsx src/main.ts browser xiaoqu close
```

**Output:** confirmed codes (notes for Task 2) + a golden test with a real URL.

---

## Task 2: Create the `xiaoqu-filters.js` helper (TDD)

**Files:**
- Create: `clis/ke/xiaoqu-filters.js`
- Test: `clis/ke/xiaoqu-filters.test.js` (extend the golden file from Task 1)

- [ ] **Step 1: Add behavior tests**

Append to `clis/ke/xiaoqu-filters.test.js`:

```js
describe('buildXiaoquFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildXiaoquFilterPath({})).toBe('');
  });
  it('maps age and sort through their tables', () => {
    expect(buildXiaoquFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildXiaoquFilterPath({ sort: 'avg-price-asc' })).toBe(SORT['avg-price-asc']);
  });
  it('emits the near-subway code only when truthy', () => {
    expect(buildXiaoquFilterPath({ 'near-subway': true })).toBeTruthy();
    expect(buildXiaoquFilterPath({ 'near-subway': false })).toBe('');
    expect(buildXiaoquFilterPath({})).toBe('');
  });
  it('encodes a two-sided avg-price range', () => {
    expect(buildXiaoquFilterPath({ 'min-price': 3, 'max-price': 5 })).toBe('PFX3t5');
  });
  it('keeps a literal 0 lower bound for avg-price', () => {
    expect(buildXiaoquFilterPath({ 'min-price': 0, 'max-price': 5 })).toBe('PFX0t5');
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildXiaoquFilterPath({ age: '10', sort: 'avg-price-asc' });
    const b = buildXiaoquFilterPath({ sort: 'avg-price-asc', age: '10' });
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });
});
```

(Replace `PFX` with the avg-price prefix confirmed in Task 1, in both the test and impl.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project adapter clis/ke/xiaoqu-filters.test.js`
Expected: FAIL — `Failed to resolve import "./xiaoqu-filters.js"`.

- [ ] **Step 3: Implement `clis/ke/xiaoqu-filters.js`**

Paste the codes confirmed in Task 1 (values below are starting guesses — REPLACE each,
including `PFX` and `NEAR_SUBWAY_CODE`, with your Task 1 captures):

```js
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
export const SORT = { 'avg-price-asc': 'co21', 'avg-price-desc': 'co22' };
const NEAR_SUBWAY_CODE = 'm1';
const AVG_PRICE_PREFIX = { begin: 'p', mid: 't' }; // -> p{min}t{max}; confirm in Task 1

function present(v) {
  return v !== undefined && v !== null && v !== '';
}
function lookup(table, key) {
  if (!present(key)) return '';
  return table[String(key)] || '';
}
function nearSubwayCode(kwargs) {
  return kwargs['near-subway'] ? NEAR_SUBWAY_CODE : '';
}
function avgPriceCode(kwargs) {
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!present(min) && !present(max)) return '';
  // Apply the one-sided rule confirmed in Task 1 (e.g. default min to 0 for max-only).
  const lo = present(min) ? min : 0;
  return `${AVG_PRICE_PREFIX.begin}${lo}${AVG_PRICE_PREFIX.mid}${present(max) ? max : ''}`;
}

// Canonical order confirmed in Task 1.
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(AGE, k.age),
  (k) => nearSubwayCode(k),
  (k) => avgPriceCode(k),
];

/**
 * Build the Beike xiaoqu filter/sort code segment for /xiaoqu/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildXiaoquFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
```

- [ ] **Step 4: Reconcile with Task 1 findings**

Replace every guessed value (`AGE`, `SORT`, `NEAR_SUBWAY_CODE`, `AVG_PRICE_PREFIX`, the
one-sided rule) and reorder `SEGMENT_PRODUCERS` to match Task 1. Replace `PFX` and
`REPLACE_WITH_CAPTURED_SEGMENT` in the tests with the real captures.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project adapter clis/ke/xiaoqu-filters.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add clis/ke/xiaoqu-filters.js clis/ke/xiaoqu-filters.test.js
git commit -m "feat(ke): add xiaoqu filter/sort code helper"
```

---

## Task 3: Wire the helper into `xiaoqu.js` (TDD)

**Files:**
- Modify: `clis/ke/xiaoqu.js`
- Test: `clis/ke/xiaoqu.test.js`

- [ ] **Step 1: Write the failing command tests**

Create `clis/ke/xiaoqu.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './xiaoqu.js';
import { buildXiaoquFilterPath } from './xiaoqu-filters.js';

const cmd = () => getRegistry().get('ke/xiaoqu');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/xiaoqu command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['min-price', 'max-price', 'age', 'near-subway', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toEqual(['avg-price-asc', 'avg-price-desc']);
    const ns = c.args.find((a) => a.name === 'near-subway');
    expect(ns.type).toBe('boolean');
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'xuhui', age: '10', 'near-subway': true, limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildXiaoquFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.ke.com/xiaoqu/xuhui/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: no filters, with district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'gz', district: 'tianhe', limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://gz.ke.com/xiaoqu/tianhe/', expect.anything(),
    );
  });

  it('backward-compat: no district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/xiaoqu/', expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project adapter clis/ke/xiaoqu.test.js`
Expected: FAIL — new args missing.

- [ ] **Step 3: Update `clis/ke/xiaoqu.js`**

Add the import after the existing imports:

```js
import { buildXiaoquFilterPath } from './xiaoqu-filters.js';
```

Replace the `args: [ ... ]` array with:

```js
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, tianhe, xuhui' },
        { name: 'min-price', type: 'int', help: '最低均价（万/㎡）' },
        { name: 'max-price', type: 'int', help: '最高均价（万/㎡）' },
        { name: 'age', choices: ['5', '10', '15', '20', '20+'], help: '楼龄：5/10/15/20 年以内，20+ 为 20 年以上' },
        { name: 'near-subway', type: 'boolean', help: '仅看近地铁小区' },
        { name: 'sort', choices: ['avg-price-asc', 'avg-price-desc'], help: '排序：avg-price-asc|desc(小区均价)；不传为默认排序' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
```

Replace the URL-assembly block (the `let path` / `if (kwargs.district)` lines that build
`path`, then the `await gotoKe(page, base + path)` call — currently
`clis/ke/xiaoqu.js:13-23` region) so the filter segment is inserted:

```js
        let path = '/xiaoqu/';
        if (kwargs.district) {
            path = `/xiaoqu/${kwargs.district}/`;
        }

        const filters = buildXiaoquFilterPath(kwargs);
        await gotoKe(page, base + path + (filters ? filters + '/' : ''));
```

Leave the `page.evaluate` scrape and `.slice(0, limit)` unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project adapter clis/ke/xiaoqu.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clis/ke/xiaoqu.js clis/ke/xiaoqu.test.js
git commit -m "feat(ke): expose xiaoqu filters and sort"
```

---

## Task 4: Validate, rebuild manifest, live smoke, finalize

**Files:** Modify `cli-manifest.json` (regenerated).

- [ ] **Step 1: Registry validation**

Run: `npx tsx src/main.ts validate ke/xiaoqu`
Expected: PASS (0 errors).

- [ ] **Step 2: Rebuild the manifest**

Run: `npx tsx src/build-manifest.ts`
Expected: `✅ Manifest compiled`. Confirm only xiaoqu changed:
`git diff cli-manifest.json | grep -E '"site"' | grep -v '"ke"'` should be empty.

- [ ] **Step 3: Full adapter test suite**

Run: `npm run test:adapter`
Expected: PASS, including the two new `clis/ke/xiaoqu*.test.js` files.

- [ ] **Step 4: Inspect help output**

Run: `npx tsx src/main.ts ke xiaoqu --help`
Expected: all new flags appear with help + `choices` (and `--near-subway` as a flag).

- [ ] **Step 5: Live smoke (needs logged-in Chrome + extension)**

```bash
npx tsx src/main.ts ke xiaoqu --city gz --district tianhe --age 10 --near-subway --sort avg-price-asc --limit 5 -v -f json
```

Expected: a JSON array of ≤5 communities; the `-v` URL matches the helper output; results
look age/subway filtered and ordered by ascending avg price. If a filter didn't apply, fix
the constant + its test and re-run `npm run test:adapter`.

- [ ] **Step 6: Commit the manifest (+ any smoke fixes)**

```bash
git add cli-manifest.json clis/ke/xiaoqu-filters.js clis/ke/xiaoqu-filters.test.js
git commit -m "chore(ke): rebuild manifest for xiaoqu filters and sort"
```

---

## Self-Review notes

- **Spec coverage:** avg-price range + one-sided handling (Task 2 `avgPriceCode`), age
  (Task 2/3), near-subway boolean (Task 2 `nearSubwayCode` + Task 3 `type: boolean`),
  `--sort` avg-price asc/desc (Task 2/3), pure separate module (Task 2), canonical order
  (Task 2 `SEGMENT_PRODUCERS`), live verification + golden URL (Task 1), tests in `adapter`
  project (Task 2–4), backward-compat (Task 3 tests), bands/location excluded (no task).
  All spec sections map to a task.
- **avg-price one-sided:** handled in new code per the ershoufang lesson (not skipped like
  zufang's rent, because this is fresh code) — verified live in Task 1.
- **near-subway flag:** declared `type: boolean` with no default, so commander registers
  `--near-subway [value]`; the bare flag yields `true`, which `coerceAndValidateArgs`
  keeps as boolean `true`; the helper emits the code only when truthy.
- **Guessed vs confirmed:** every code (`AGE`, `SORT`, `NEAR_SUBWAY_CODE`, `AVG_PRICE_PREFIX`,
  the one-sided rule, the `PFX`/segment placeholders) is reconciled in Task 2 Step 4 against
  Task 1; the golden URL pins real behavior.
