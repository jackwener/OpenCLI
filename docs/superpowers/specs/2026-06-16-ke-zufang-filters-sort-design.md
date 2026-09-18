# Design: Expand `ke zufang` filters & sort

Date: 2026-06-16
Branch: `worktree-expand-ke-params`
Status: Approved (pending spec review)

## Goal

Extend `opencli ke zufang` (贝壳找房租房列表) to support the site's rental filters and
result sort, exposed as optional CLI params. Today the command only supports a rent range
(`--min-price`/`--max-price`). This mirrors the just-completed `ke ershoufang` work, but
zufang is a **separate endpoint** — it lives on `https://{city}.zu.ke.com/zufang/...` and
uses its own filter code scheme (rent price is already encoded `rp{min}t{max}`, not `p`).
So the codes and canonical order must be verified independently against the live rental
site; they are NOT shared with ershoufang.

## Scope

### New filter params (all optional, English short-keyword values, `choices`-constrained)

| Param | Values | Beike category | Code |
|-------|--------|----------------|------|
| `--rent-type` | `whole` `shared` | 方式（整租/合租） | ⚠️ verify |
| `--rooms` | int `1`–`4` (4 = 四居+) | 户型（一居/两居/三居/四居+） | ⚠️ verify |
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 | ⚠️ verify |
| `--features` | comma-multi: `near-subway` `bag-in` `fine` `deposit-one` `new` `certified` `anytime-view` `vr` `owner-rec` | 特色 | ⚠️ verify |
| `--lease-term` | `monthly` `yearly` `min-1month` `1-3months` `4-6months` | 租期 | ⚠️ verify |
| `--floor` | `low` `mid` `high` | 楼层 | ⚠️ verify |
| `--elevator` | `yes` `no` | 电梯 | ⚠️ verify |

`--features` keyword→label: near-subway(近地铁), bag-in(拎包入住), fine(精装修),
deposit-one(押一付一), new(新上), certified(认证公寓), anytime-view(随时看房), vr(VR房源),
owner-rec(业主自荐).

### New sort param

Follows the project's Pattern A convention (single combined `--sort` enum), same as
ershoufang.

- `--sort` : `newest`(最新上架) · `rent-asc` · `rent-desc` · `area-asc` · `area-desc`.
  Omitted ⇒ Beike default (综合排序). → `co??` codes ⚠️ verify.

### Unchanged (backward-compatible)

`--city`, `--district`, `--min-price`/`--max-price` (existing `rp{min}t{max}` rent
encoding kept exactly as-is, per decision — including its one-sided/`0` behavior, NOT
changed), `--limit`. All new params optional; existing invocations behave identically.

### Out of scope (YAGNI)

品牌(brand — city-specific and unstable), 区域/地铁线 location codes, 租金 enum bands,
the other `ke` commands. The one-sided/`0` rent-range fix that was applied to ershoufang's
`areaCode` is explicitly NOT applied here — rent encoding stays as-is.

## Architecture

### New module: `clis/ke/zufang-filters.js` (pure, browser-free, unit-testable)

Mirrors `clis/ke/filters.js` (ershoufang) in shape but is a separate module with its own
tables — zufang codes differ and the two should not be coupled (YAGNI; no shared abstraction).

Exports:

1. **Mapping tables** — `RENT_TYPE`, `ROOMS` (or a `roomsCode` helper), `ORIENTATION`,
   `FEATURES`, `LEASE_TERM`, `FLOOR`, `ELEVATOR`, `SORT` — keyword → Beike code.
2. **`buildZufangFilterPath(kwargs)`** → returns the ordered code segment string (no
   leading/trailing slash), `''` when nothing active. Owns the canonical ordering via a
   fixed `SEGMENT_PRODUCERS` list, like ershoufang.

Reuses the same small internal helpers' *shape* (`present()`, `lookup()`, per-item
`featuresCode` that throws `ArgumentError` on an unknown keyword) but defined locally —
not imported from `filters.js`.

### `clis/ke/zufang.js` changes

- Add the new arg definitions. Single-value enums (`--rent-type`, `--orientation`,
  `--lease-term`, `--floor`, `--elevator`, `--sort`) use `choices`. `--rooms` is `int`.
  `--features` is comma-multi, validated per-item inside `buildZufangFilterPath` (`choices`
  can't validate a comma list).
- Move the rent-price encoding into `buildZufangFilterPath` as one producer in the
  canonical `SEGMENT_PRODUCERS` list, keeping its exact `rp{min}t{max}` byte output
  unchanged (including the one-sided/`0` behavior). `zufang.js` then assembles
  `url = baseUrl + path + (seg ? seg + '/' : '')` where `seg = buildZufangFilterPath(kwargs)`.
  The rent segment's position relative to the new codes is verified live.
- DOM scraping (`page.evaluate` block) and result shaping are **unchanged**.

## Filter-code verification (the "explore enums" step)

Before finalizing the tables, verify every ⚠️ code and the canonical concatenation order
against the live rental site using `opencli browser` against
`https://sh.zu.ke.com/zufang/pudong/` (and spot-check one other city, e.g. bj, for the
in-scope enums): toggle each filter / sort option and read the resulting URL path.
Capture at least two real multi-filter URLs to pin as golden regression tests, and to
establish where the rent `rp...` segment sits in the canonical order relative to the new
codes.

## Testing

Colocated `clis/ke/zufang-filters.test.js` and additions to the zufang command coverage,
run via the vitest `adapter` project (`npm run test:adapter`). Mirrors the existing adapter
test style (register command, mock `page.{goto,wait,evaluate}`, assert the URL passed to
`page.goto`).

1. **`buildZufangFilterPath` unit tests** (pure, no browser): each filter alone →
   expected code; `--features` multi-value → concatenated codes in table order;
   `--rooms` → expected code; `--sort` each value → expected `co` code; a full combination
   → canonical order regardless of kwargs key order; empty kwargs → `''`; unknown
   `--features` keyword → throws.
2. **Live golden tests**: pin ≥2 real captured multi-filter URLs.
3. **`zufang.func` URL test**: assert `page.goto` is called with the fully assembled URL
   (including the unchanged `rp{min}t{max}` rent segment in its verified position).
4. **Backward-compat test**: existing rent-range-only and no-filter invocations produce
   the same URLs as before.

## Risks

- **Wrong codes / order**: mitigated by live verification before shipping + unit tests
  pinning expected URLs + ≥2 ground-truth golden URLs.
- **rent segment position**: its placement among the new codes is verified live, not
  assumed.
- **City-specific codes**: in-scope enums verified on ≥2 cities; brand explicitly excluded.
