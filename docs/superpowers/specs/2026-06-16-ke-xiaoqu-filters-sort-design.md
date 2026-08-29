# Design: Expand `ke xiaoqu` filters & sort

Date: 2026-06-16
Branch: `worktree-expand-ke-params`
Status: Approved (pending spec review)

## Goal

Extend `opencli ke xiaoqu` (贝壳找房小区列表) to support the site's community filters and
sort, exposed as optional CLI params. Today the command supports only `--city`,
`--district`, `--limit`. xiaoqu's filter UI is small — just three categories (均价 custom
range, 楼龄, 近地铁) plus a two-state sort (默认排序 / 小区均价). It lives on
`https://{city}.ke.com/xiaoqu/...` (same subdomain as ershoufang), but its filter codes
are verified independently and NOT shared with ershoufang's module.

## Scope

### New params (all optional)

| Param | Values | Beike category | Code |
|-------|--------|----------------|------|
| `--min-price` / `--max-price` | int (万) | 均价 custom range | custom-range code ⚠️ verify |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄（N 年以内/以上） | ⚠️ verify (likely `y1`–`y5`) |
| `--near-subway` | boolean flag | 近地铁 | ⚠️ verify |
| `--sort` | `avg-price-asc` `avg-price-desc` | 小区均价 (toggles asc/desc); omitted ⇒ 默认排序 | `co??` ⚠️ verify |

`--near-subway` is a standalone boolean (xiaoqu has only this one feature; no
`--features` multi-select). `--age` reuses the ershoufang keyword set but its codes are
re-verified on the xiaoqu endpoint.

### Unchanged (backward-compatible)

`--city`, `--district`, `--limit`. All new params optional; existing invocations behave
identically.

### Out of scope (YAGNI)

区域/地铁线 location codes, 均价 enum bands (only the custom range is supported), other
`ke` commands.

## Architecture

### New module: `clis/ke/xiaoqu-filters.js` (pure, browser-free, unit-testable)

Mirrors the ershoufang/zufang helper shape but is a separate module with its own tables —
xiaoqu codes are verified independently and the modules stay decoupled (YAGNI; no shared
abstraction).

Exports:

1. **Mapping tables** — `AGE`, `SORT` (keyword → code).
2. **`buildXiaoquFilterPath(kwargs)`** → returns the ordered code segment string (no
   leading/trailing slash), `''` when nothing active. Owns canonical ordering via a fixed
   `SEGMENT_PRODUCERS` list. Producers: sort, age, near-subway (emits its code when the
   boolean is true), avg-price custom range.

Reuses the established helper shapes (`present()`, `lookup()`) defined locally.

### `clis/ke/xiaoqu.js` changes

- Add the new arg definitions. `--age` and `--sort` use `choices`; `--near-subway` is
  `type: boolean`; `--min-price`/`--max-price` are `int`.
- Replace the inline path assembly with: `const filters = buildXiaoquFilterPath(kwargs);`
  then `url = base + path + (filters ? filters + '/' : '')` (base = `cityUrl(city)`,
  path = `/xiaoqu/` or `/xiaoqu/{district}/`).
- DOM scraping (`page.evaluate` block) and result shaping are **unchanged**.

## Filter-code verification (the "explore enums" step)

Before finalizing the tables, verify every ⚠️ code, the avg-price custom-range prefix, the
near-subway code, and the canonical order against the live site using `opencli browser
eval` to read the filter-panel `<a href>` codes directly (as done for zufang) against
`https://sh.ke.com/xiaoqu/xuhui/`. Determine the avg-price one-sided behavior (min-only /
max-only) the way ershoufang's area was verified, and handle it correctly. Capture ≥1
real multi-filter URL as a golden regression test, and confirm the sort asc/desc codes by
reading the first result's avg price. Spot-check one other city (e.g. bj) for the enums.

## Testing

Colocated `clis/ke/xiaoqu-filters.test.js` and additions to the xiaoqu command coverage,
run via the vitest `adapter` project (`npm run test:adapter`). Mirrors the existing adapter
test style (register command, mock `page.{goto,wait,evaluate}`, assert the URL passed to
`page.goto`).

1. **`buildXiaoquFilterPath` unit tests** (pure): each filter alone → expected code;
   `--near-subway true` → its code, absent/false → no code; avg-price range (two-sided and
   the verified one-sided shapes); `--sort` each value → expected code; canonical order;
   empty kwargs → `''`.
2. **Live golden test**: pin ≥1 real captured multi-filter URL.
3. **`xiaoqu.func` URL test**: assert `page.goto` is called with the assembled URL.
4. **Backward-compat test**: existing no-filter / district-only invocations produce the
   same URLs as before.

## Risks

- **Wrong codes / order**: mitigated by live verification + unit tests pinning expected
  URLs + ≥1 ground-truth golden URL.
- **avg-price one-sided encoding**: explicitly verified live (apply the ershoufang lesson —
  an upper-bound-only query may need an explicit min).
- **City-specific codes**: enums verified on ≥2 cities; avg-price bands differ per city but
  are out of scope (custom range only).
