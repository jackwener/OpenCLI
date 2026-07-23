# Ke

**Mode**: 🔐 Browser · **Domain**: `ke.com`

贝壳找房 (Beike). Each command returns a structured list and accepts optional filters and a
sort, encoded as path segments in the Beike URL.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ke ershoufang` | Browse second-hand housing listings (二手房) |
| `opencli ke zufang` | Browse rental listings (租房) |
| `opencli ke xiaoqu` | Browse neighborhood / community listings (小区) |
| `opencli ke chengjiao` | Browse recent transaction records (成交) |

## Common options

| Option | Description |
|--------|-------------|
| `--city` | Short city code: `bj`(北京) `sh`(上海) `gz`(广州) `sz`(深圳) `hz`(杭州) `zs`(中山) … (default `bj`) |
| `--district` | District slug used in Beike URLs, e.g. `chaoyang`, `haidian`, `tianhe`, `xuhui`, `pudong` |
| `--limit` | Number of rows to return (default 20) |

All filters are optional and combine. Beike parses the filter codes by prefix, so order
does not matter. Enum options are validated (`choices`); an invalid value errors out.

## `ershoufang` — second-hand listings

| Option | Values | Meaning |
|--------|--------|---------|
| `--min-price` / `--max-price` | int (万) | Total-price range |
| `--min-area` / `--max-area` | int (㎡) | Building-area range |
| `--rooms` | int 1–5 | Bedrooms (几室) |
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 |
| `--floor` | `low` `mid` `high` | 楼层 |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄 (N 年以内 / 20+ 以上) |
| `--decoration` | `fine` `simple` `rough` | 装修 (精装/普通/毛坯) |
| `--elevator` | `yes` `no` | 电梯 |
| `--features` | comma-separated: `must-see` `five-years` `two-years` `near-subway` `vr` `new-7d` `anytime-view` | 房源特色 (multi-select) |
| `--usage` | `residential` `commercial` `villa` `courtyard` `parking` `other` | 用途 |
| `--sort` | `newest` `total-price-asc` `total-price-desc` `unit-price-asc` `unit-price-desc` `area-asc` `area-desc` | 排序 (omit = default) |

## `zufang` — rentals

| Option | Values | Meaning |
|--------|--------|---------|
| `--min-price` / `--max-price` | int (元/月) | Monthly-rent range |
| `--rent-type` | `whole` `shared` | 方式 (整租/合租) |
| `--rooms` | int 1–4 | 户型 (4 = 四居+) |
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 |
| `--features` | comma-separated: `near-subway` `bag-in` `fine` `deposit-one` `new` `certified` `anytime-view` `vr` `owner-rec` | 特色 (multi-select) |
| `--lease-term` | `monthly` `yearly` `min-1month` `1-3months` `4-6months` | 租期 |
| `--floor` | `low` `mid` `high` | 楼层 |
| `--elevator` | `yes` `no` | 电梯 |
| `--sort` | `newest` `rent-asc` `rent-desc` `area-asc` `area-desc` | 排序 (omit = 综合) |

## `xiaoqu` — communities

| Option | Values | Meaning |
|--------|--------|---------|
| `--min-price` / `--max-price` | int (万/㎡) | Average-price range (均价) |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄 |
| `--near-subway` | flag | 仅看近地铁小区 (bare flag, no value) |
| `--sort` | `avg-price-asc` `avg-price-desc` | 小区均价 (omit = default) |

## `chengjiao` — transaction records

| Option | Values | Meaning |
|--------|--------|---------|
| `--min-area` / `--max-area` | int (㎡) | Building-area range |
| `--rooms` | int 1–5 | 几室 |
| `--orientation` | `south-north` `south` `east` `north` `west` | 朝向 |
| `--floor` | `low` `mid` `high` | 楼层 |
| `--age` | `5` `10` `15` `20` `20+` | 楼龄 |
| `--decoration` | `fine` `simple` `rough` | 装修 |
| `--usage` | `residential` `commercial` `villa` `courtyard` `parking` `other` | 用途 |
| `--elevator` | `yes` `no` | 电梯 |
| `--sort` | `total-price-asc` `total-price-desc` `unit-price-asc` `unit-price-desc` `area-asc` `area-desc` | 排序 (no `newest`; omit = default) |

## Usage Examples

```bash
# Beijing second-hand housing
opencli ke ershoufang --city bj --district chaoyang --limit 10

# Hangzhou Xihu, 3-room rough-finish, newest first
opencli ke ershoufang --city hz --district xihuqu4 --rooms 3 --decoration rough --sort newest

# Shanghai rentals: whole-unit 2-bed under 8000/月, newest first
opencli ke zufang --city sh --district pudong --rent-type whole --rooms 2 --max-price 8000 --sort newest

# Hangzhou Xihu communities: ≤10y, near subway, cheapest avg-price first
opencli ke xiaoqu --city hz --district xihuqu4 --age 10 --near-subway --sort avg-price-asc

# Beijing Haidian deals: 3-room, highest total price first
opencli ke chengjiao --city bj --district haidian --rooms 3 --sort total-price-desc --limit 5
```

## Prerequisites

- Chrome running and logged into `ke.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `--city` uses short city codes such as `bj`, `sh`, `gz`, `sz`, `hz`; `--district` expects
  the district slug used in Beike URLs (e.g. `chaoyang`, `haidian`, `xihuqu4`).
- For numeric ranges, an upper-bound-only query is normalized to include an explicit lower
  bound of 0 (Beike ignores a bare upper bound), e.g. `--max-area 90` filters "90㎡以下".
- `--features` (ershoufang/zufang) takes a comma-separated list; an unknown keyword errors out.
- `zufang` 户型 is zero-based in Beike's URLs (一居 = `l0`); the `--rooms` value stays
  1-based (`--rooms 2` = 两居). This is handled internally.
- Avg/total/unit-price band differences across cities mean only the custom range
  (`--min-price`/`--max-price`) is exposed, not the per-city preset bands.
- Heavy filtered browsing can trigger Beike's risk-control captcha; if a command reports
  "触发了验证码", complete the verification in your logged-in Chrome and retry.
