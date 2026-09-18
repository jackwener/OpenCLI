# Design: Expand `ke chengjiao` filters & sort

Date: 2026-06-16
Branch: `worktree-expand-ke-params`
Status: Approved (pending spec review)

## Goal

Extend `opencli ke chengjiao` (贝壳找房成交记录 — sold/deal records) to support the site's
filters and sort, exposed as optional CLI params. Today the command supports only
`--city`, `--district`, `--limit`. chengjiao lives on `https://{city}.ke.com/chengjiao/...`
(same subdomain as ershoufang) and its filter codes are the SAME Beike residential scheme
(`l3`=三室, `sf1`=普通住宅, `de3`=毛坯 confirmed identical to ershoufang). Per the
architecture decision, the codes are nonetheless implemented in a **separate, independently
verified module** — consistent with the zufang/xiaoqu per-command pattern; ershoufang's
`filters.js` is NOT imported or modified.

## Scope

### New params (all optional, English short-keyword values, `choices`-constrained)

| Param | Values | Beike category | Code |
|-------|--------|----------------|------|
| `--rooms` | int `1`–`5` | 房型（一~五室） | `l{n}` ⚠️ (l3=三室 confirmed) |
| `--min-area` / `--max-area` | int (㎡) | 建筑面积 custom range | `ba{min}ea{max}`, default min→0 for max-only ⚠️ |
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 | ⚠️ verify |
| `--floor` | `low` `mid` `high` | 楼层 | ⚠️ verify (verify properly on chengjiao) |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄 | ⚠️ verify (likely `y1`–`y5`) |
| `--decoration` | `fine` `simple` `rough` | 装修 | ⚠️ verify (de3=毛坯 confirmed) |
| `--usage` | `residential` `commercial` `villa` `courtyard` `parking` `other` | 用途 | ⚠️ verify (sf1=普通住宅 confirmed) |
| `--elevator` | `yes` `no` | 电梯 | ⚠️ verify |
| `--sort` | `total-price-asc` `total-price-desc` `unit-price-asc` `unit-price-desc` `area-asc` `area-desc` | 排序（总价/房屋单价/面积）; omitted ⇒ 默认排序 | `co??` ⚠️ verify |

### Differences from ershoufang (intentional)

- **No `--features`** — chengjiao has no 房源特色 category.
- **No price filter** — deal price is not filterable on chengjiao (only sortable); the
  numeric range filter is **area**, not price.
- **Sort has no `newest`** — chengjiao's sort tabs are only 总价/房屋单价/面积 (no 最新发布).

### Unchanged (backward-compatible)

`--city`, `--district`, `--limit`. All new params optional; existing invocations behave
identically.

### Out of scope (YAGNI)

房源特色, price filter, 区域/地铁线 location codes, 面积 enum bands, 供暖 (Beijing-only,
not cross-city consistent), other `ke` commands.

## Architecture

### New module: `clis/ke/chengjiao-filters.js` (pure, browser-free, unit-testable)

A separate module with its own tables, independently verified on the chengjiao endpoint —
consistent with the zufang/xiaoqu per-command pattern; no shared abstraction with
ershoufang (decoupled by decision, despite identical codes).

Exports:

1. **Mapping tables** — `ORIENTATION`, `FLOOR`, `AGE`, `DECORATION`, `ELEVATOR`, `USAGE`,
   `SORT` (keyword → code), plus a `roomsCode` and an `areaCode` helper.
2. **`buildChengjiaoFilterPath(kwargs)`** → returns the ordered code segment string (no
   leading/trailing slash), `''` when nothing active. Owns canonical ordering via a fixed
   `SEGMENT_PRODUCERS` list. Reuses the established helper shapes (`present()`, `lookup()`)
   defined locally.

`areaCode` applies the verified one-sided rule (min-only emits `ba{min}ea`; max-only
defaults the lower bound to 0 → `ba0ea{max}`), mirroring ershoufang's area handling.

### `clis/ke/chengjiao.js` changes

- Add the new arg definitions. Single-value enums (`--orientation`, `--floor`, `--age`,
  `--decoration`, `--usage`, `--elevator`, `--sort`) use `choices`; `--rooms`,
  `--min-area`, `--max-area` are `int`.
- Replace the inline path assembly with: `const filters = buildChengjiaoFilterPath(kwargs);`
  then `gotoKe(page, base + path + (filters ? filters + '/' : ''))`.
- DOM scraping (`page.evaluate` block) and result shaping are **unchanged**.

## Filter-code verification (the "explore enums" step)

The chengjiao filter panel is JS-driven (not `<a href>`), so verify by constructing
candidate URLs and reading `document.title` (the title reflects active filters, e.g.
`上海徐汇、三室二手房网签`), the way ershoufang's area was verified. Confirm every ⚠️ code,
the area one-sided behavior, the sort asc/desc codes (read the first record's price/area to
infer direction), and the canonical order. Pace requests to avoid the captcha/rate-limit
(seen after ~5 rapid hits). Capture ≥1 real multi-filter URL as a golden test, and
spot-check one other city (e.g. bj) for the enums.

## Testing

Colocated `clis/ke/chengjiao-filters.test.js` and additions to the chengjiao command
coverage, run via the vitest `adapter` project (`npm run test:adapter`). Mirrors the
existing adapter test style (register command, mock `page.{goto,wait,evaluate}`, assert the
URL passed to `page.goto`).

1. **`buildChengjiaoFilterPath` unit tests** (pure): each filter alone → expected code;
   `--rooms` → expected `l{n}`; avg/area range two-sided + verified one-sided shapes;
   `--sort` each value → expected code; canonical order regardless of kwargs key order;
   empty kwargs → `''`.
2. **Live golden test**: pin ≥1 real captured multi-filter URL.
3. **`chengjiao.func` URL test**: assert `page.goto` is called with the assembled URL.
4. **Backward-compat test**: existing no-filter / district-only invocations produce the
   same URLs as before.

## Risks

- **Wrong codes / order**: mitigated by live verification + unit tests pinning expected
  URLs + ≥1 ground-truth golden URL.
- **Shared-code drift**: codes match ershoufang today (l3/sf1/de3 confirmed), but the
  separate module means chengjiao is verified and maintained independently — no coupling
  risk.
- **area one-sided**: explicitly verified live and handled (max-only needs an explicit min).
- **captcha during verification**: pace requests; close the browser session between batches.
