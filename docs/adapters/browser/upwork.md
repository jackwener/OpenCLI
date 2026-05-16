# Upwork

**Mode**: 🔐 Browser · **Domain**: `upwork.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli upwork search <query>` | Upwork keyword job search (logged-in browser session, US site) |
| `opencli upwork feed [tab]` | Personalized jobs feed — `best-matches` (default) or `most-recent` |
| `opencli upwork detail <id>` | Read the full Upwork job posting by ciphertext id |

## Usage Examples

```bash
# Search jobs by keyword (default 10 rows, sort by recency)
opencli upwork search "python"

# Filter and paginate
opencli upwork search "react developer" --location "United States" --sort relevance --page 2 --per_page 25

# Personalized recommended feed (requires login)
opencli upwork feed --limit 20

# Switch to the chronological feed
opencli upwork feed most-recent --limit 10

# Full job posting (id is the ciphertext form from `search` / `feed`)
opencli upwork detail "~022055006392174412621"

# Detail also accepts the full /jobs/ URL
opencli upwork detail "https://www.upwork.com/jobs/~022055006392174412621"

# JSON output
opencli upwork search "python" -f json
opencli upwork detail "~022055006392174412621" -f json
```

## Output

### `search` and `feed`

Both commands return the same column set so feeds and search results can be compared / unioned:

| Column | Type | Notes |
|--------|------|-------|
| `rank` | number | 1-based row index. For `search` it is the global rank across pages (`(page-1) * per_page + i`). |
| `id` | string | Ciphertext form (`~01…` / `~02…`). The stable public id for cross-page lookups. |
| `title` | string | Job title with Upwork's `<span class="highlight">` query markup stripped. |
| `type` | string | `hourly` or `fixed` (decoded from the numeric `type` field). |
| `budget` | string | Human-readable: `$40-$70/hr` for hourly ranges, `$30/hr` for single bounds, `$200` for fixed-price, `''` when client didn't set one. |
| `experienceLevel` | string | `entry`, `intermediate`, `expert`, or `''`. Decoded from `tierText` (search) / `tier` (feed). |
| `proposalsTier` | string | Compact bucket: `<5`, `5-10`, `10-15`, `20-50`, `50+`. Search uses the i18n-keyed form, feed uses the rendered label — both normalize to the same output. |
| `skills` | string | Comma-separated skill names from `attrs[]` / `skills[]`. Deduped. |
| `clientCountry` | string | Country name (`United States`) or ISO code (`BGD`) — Upwork is inconsistent across rows. |
| `clientRating` | number \| null | Average feedback score 0-5. `null` when the client has no reviews (we deliberately don't surface `0` as a real score). |
| `publishedOn` | string | ISO 8601 timestamp from `publishedOn` (falls back to `createdOn`). |
| `url` | string | Absolute `/jobs/<ciphertext>` URL. |

### `detail`

| Column | Type | Notes |
|--------|------|-------|
| `id` | string | Ciphertext form, normalized from the input arg. |
| `title` | string | Full title, highlight markup stripped. |
| `type` | string | `hourly` or `fixed`. |
| `budget` | string | Same format as search, but read from `extendedBudgetInfo` + `budget.amount`. |
| `experienceLevel` | string | `entry` / `intermediate` / `expert` — decoded from the numeric `contractorTier` (1 / 2 / 3). |
| `workload` | string | Pre-rendered workload string (`More than 30 hrs/week` etc.) or `''`. |
| `category` | string | Top-level category name (`Web Development`). |
| `skills` | string | Same shape as list rows. |
| `description` | string | Full job description body. |
| `clientCountry` | string | From `buyer.location.country`. |
| `clientSpent` | number \| null | Lifetime client spend in USD (`buyer.stats.totalCharges.amount`). `null` when zero / missing. |
| `clientHires` | number \| null | Number of past hires (`buyer.stats.totalJobsWithHires`). |
| `clientRating` | number \| null | Same null-on-zero rule as the list commands. |
| `proposalsCount` | number \| null | Real proposals count from `clientActivity.totalApplicants` — more precise than the bucket on list rows. |
| `publishedOn` | string | ISO 8601 from `publishTime` (falls back to `postedOn` / `createdOn`). |
| `url` | string | Absolute `/jobs/<ciphertext>` URL. |

## Prerequisites

- Chrome running and **logged into** upwork.com
- [Browser Bridge extension](/guide/browser-bridge) installed
- The connected Chrome profile needs to actually own the Upwork session for `feed` (`best-matches` / `most-recent` redirect to onboarding for visitors)

## Caveats

- **Read-only.** No commands write to your Upwork account. There is no `apply` / `submit-proposal` / `withdraw` command — proposing for jobs is deliberately out of scope.
- **No proposals command.** Listing your own submitted proposals is intentionally not shipped. Upwork's `lists` Vuex module is the right source, but verifying the field shape end-to-end requires an account with real proposals — once that data is available, see the field-map notes in `~/.opencli/sites/upwork/`.
- **Cloudflare** sits in front of every surface — all commands run through your logged-in browser session (`Strategy.COOKIE`, `browser: true`). Bare `fetch` returns a `__cf_bm` challenge. If the adapter sees the challenge page it raises `CommandExecutionError` with a hint to clear it in the connected browser.
- **List data comes from SSR state, not DOM scraping.** Upwork's card class names change often; instead the adapter reads `window.__NUXT__.state.{jobsSearch,feedBestMatch,feedMostRecent}.jobs[]` directly. Detail reads from the Vuex store at `window.$nuxt.$store.state.jobDetails.{job,buyer}`. This is more durable but means UI freshness / DOM tweaks have no effect — what you see in the browser may briefly differ from what the adapter returns if Upwork re-hydrates mid-load.
- **Login redirect** raises `AuthRequiredError` (exit 77), not an empty result.
- **`per_page`** is clamped to the [10, 50] range that Upwork's search will honor. `--limit` on `feed` is [1, 50].
