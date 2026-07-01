# Design: Expand `ke ershoufang` filters & sort

Date: 2026-06-15
Branch: `feat/expand-ke-params`
Status: Approved (pending spec review)

## Goal

Extend `opencli ke ershoufang` (贝壳找房二手房列表) to support more of the site's
listing filters and the result sort order, exposed as optional CLI params. Today the
command only supports `--rooms` and a price range (`--min-price`/`--max-price`). Beike
encodes every filter and the sort as **fixed-prefix code segments concatenated into the
URL path**, in a canonical order — e.g.:

- `https://hz.ke.com/ershoufang/xihuqu4/l3/` — 三室
- `https://hz.ke.com/ershoufang/xihuqu4/de3l3/` — 三室 + 毛坯
- `https://hz.ke.com/ershoufang/xihuqu4/de3l3p1/` — 三室 + 毛坯 + 100万以下
- `https://hz.ke.com/ershoufang/xihuqu4/co32l3p1/` — 三室 + 100万以下 + 最新发布排序

This is the surface we are extending.

## Scope

### New filter params (all optional, English short-keyword values, `choices`-constrained)

| Param | Values | Beike category | Code prefix |
|-------|--------|----------------|-------------|
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 | `f?` ⚠️ verify |
| `--floor` | `low` `mid` `high` | 楼层（低/中/高楼层） | `lc?` ⚠️ verify |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄（N 年以内/以上） | `y?` ⚠️ verify |
| `--decoration` | `fine` `simple` `rough` | 装修（精装/普通/毛坯） | `de1/de2/de3` (de3=毛坯 confirmed) |
| `--elevator` | `yes` `no` | 电梯 | `ie?` ⚠️ verify |
| `--features` | comma-separated multi: `must-see` `five-years` `two-years` `near-subway` `vr` `new-7d` `anytime-view` | 房源特色（多选） | per-feature code ⚠️ verify |
| `--usage` | `residential` `commercial` `villa` `courtyard` `parking` `other` | 用途（普通住宅/商业类/别墅/四合院/车位/其他） | enum code ⚠️ verify |

### New area range param

| Param | Type | Beike category | Code |
|-------|------|----------------|------|
| `--min-area` / `--max-area` | int (㎡) | 建筑面积 自定义区间 | custom-range code ⚠️ verify (likely `ba{min}ea{max}`) |

`--min-area`/`--max-area` mirror the shape of `--min-price`/`--max-price` (a numeric
min/max pair) but encode via Beike's own custom-area prefix (kept separate from the
price prefix to avoid collision).

### New sort param

Follows the project's established convention (`--sort` single combined enum,
Pattern A — used by ~20/29 adapters such as `eastmoney`, `coingecko`; no adapter uses a
split field+direction form).

- `--sort` : `newest` · `total-price-asc` · `total-price-desc` · `unit-price-asc` ·
  `unit-price-desc` · `area-asc` · `area-desc`. Omitted ⇒ Beike default sort.
  → `co??` codes ⚠️ verify (`co32`=最新发布 confirmed from example).

### Unchanged (backward-compatible)

`--city`, `--district`, `--rooms` (int → `l{n}`), `--min-price`/`--max-price`
(existing `p{min}t{max}` encoding kept as-is per decision), `--limit`. All new params
are optional; existing invocations behave identically.

### Out of scope (YAGNI)

区域/地铁线 location codes; 权属/类型/供暖/面积枚举段; multi-select for non-`features`
categories; reworking the existing price `p{min}t{max}` encoding; the other `ke` commands
(`xiaoqu`, `zufang`, `chengjiao`).

## Architecture

### New module: `clis/ke/filters.js` (pure, browser-free, unit-testable)

Exports:

1. **Mapping tables** — one per enum category (`ORIENTATION`, `FLOOR`, `AGE`,
   `DECORATION`, `ELEVATOR`, `FEATURES`, `USAGE`, `SORT`), each mapping the
   English keyword → Beike code.
2. **`buildErshoufangFilterPath(kwargs)`** → returns the ordered code segment string
   (without leading/trailing slash), or `''` when no filters/sort are active.

`buildErshoufangFilterPath` is responsible for the **canonical ordering**: it walks a
fixed ordered list of `(prefix, value)` producers and concatenates active codes in
Beike's required order (NOT user input order). From the anchors we know the order
includes `co`(sort) → … → `de`(decoration) → `l`(rooms) → `p`(price); the full ordering
of all prefixes is finalized during the browser-verification step below.

### `clis/ke/ershoufang.js` changes

- Add the new arg definitions. Single-value enums (`--orientation`, `--floor`, `--age`,
  `--decoration`, `--elevator`, `--usage`, `--sort`) use `choices` so
  `coerceAndValidateArgs` rejects bad values early (see `src/execution.ts`
  `coerceAndValidateArgs`). `--features` is comma-separated multi, so `choices` (which
  validates the whole string) does NOT apply — each item is validated inside
  `buildErshoufangFilterPath`, which throws `ArgumentError` on an unknown feature keyword.
- Replace the inline price/room URL assembly with a call to
  `buildErshoufangFilterPath(kwargs)`; build `url = base + /ershoufang/{district}/ +
  (codeSegment ? codeSegment + '/' : '')`.
- DOM scraping (`page.evaluate` block) and result shaping are **unchanged**.

## Filter-code verification (the "explore enums" step)

Before finalizing the mapping tables, verify every ⚠️ code and the canonical
concatenation order against the live site using `opencli browser` against
`hz.ke.com/ershoufang/xihuqu4`: toggle each filter / sort option in the UI and read the
resulting URL path. Record the confirmed `prefix → meaning` for each value into the
mapping tables. Known anchors to start from: `de3`=毛坯, `l3`=三室, `p1`=100万以下,
`co32`=最新发布. Verification also confirms whether codes differ between cities for the
in-scope categories (price bands are known to differ and are out of scope; the in-scope
enums are expected to be city-stable — confirm at least hz + one other city, e.g. bj).

## Testing

Colocated `clis/ke/filters.test.js` and additions to ershoufang coverage, run via the
vitest `adapter` project (`npm run test:adapter`). Mirrors the existing adapter test
style (register command, mock `page.{goto,wait,evaluate}`, assert the URL passed to
`page.goto`).

1. **`buildErshoufangFilterPath` unit tests** (pure, no browser):
   - each filter alone → expected single code
   - `--features` multi-value → concatenated feature codes
   - `--min-area`/`--max-area` → expected custom-area code
   - `--sort` each value → expected `co` code
   - a full combination → codes emitted in canonical order regardless of kwargs key order
   - empty kwargs → `''`
   - invalid enum value is rejected upstream by `choices` (assert via arg def / command)
2. **`ershoufang.func` URL test**: given kwargs, assert `page.goto` is called with the
   fully assembled URL (e.g. `https://hz.ke.com/ershoufang/xihuqu4/co32de3l3p1/`).
3. **Backward-compat test**: existing `--rooms` / price-only invocations produce the
   same URLs as before.

## Risks

- **Code drift / wrong codes**: mitigated by the live-site verification step before
  shipping, and by unit tests pinning the expected URLs.
- **Canonical order**: if codes are emitted in the wrong order Beike may ignore filters;
  the fixed ordered producer list + the combination URL test guard this.
- **City-specific codes**: in-scope enums verified on ≥2 cities; price bands explicitly
  excluded.
