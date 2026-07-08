# Indeed

**Mode**: 🍪 Browser (cookie) · **Domain**: `www.indeed.com`

Indeed sits behind Cloudflare and answers bare HTTP fetches with `403`
and a `cf-mitigated: challenge` header, so the adapter drives a real
browser session. DOM extraction happens against the rendered page.

## Commands

| Command | Description |
|---------|-------------|
| `opencli indeed search <query>` | Keyword job search on the US site |
| `opencli indeed job <jk>` (alias `detail`, `view`) | Read the full job posting by `jk` (job key) |

## Usage Examples

```bash
# Quick start — first run will route through the browser session
opencli indeed search "rust developer" --limit 10

# Narrow to recent jobs in a location, sorted by date
opencli indeed search "site reliability engineer" \
  --location "Remote" --fromage 7 --sort date

# Read a job posting using the `id` surfaced by `search`
opencli indeed job dccc07ac5a6a3683

# JSON output
opencli indeed search "data engineer" -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, title, company, location, salary, tags, url` |
| `job` | `id, title, company, location, salary, job_type, description, url` |

`id` is the Indeed **job key (jk)** — a 16-character lowercase hex
identifier. Pipe it into `opencli indeed job <jk>` to drill into the full
posting (per the
[listing↔detail ID pairing convention](../../conventions/listing-detail-id-pairing.md)).

## Args

### `search`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `query` *(positional, required)* | string | — | Job title / skill / company |
| `--location` | string | *(none)* | E.g. `"Remote"`, `"New York, NY"` |
| `--fromage` | string | *(none)* | Recency filter, days back: `1` / `3` / `7` / `14` |
| `--sort` | string | `relevance` | `relevance` or `date` |
| `--start` | int | `0` | Pagination offset (multiple of 10, 0-based) |
| `--limit` | int | `15` | Max rows to return (1–25, capped to one page) |

### `job`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `id` *(positional, required)* | string | — | Job key (16-char lowercase hex from `search`) |

## Prerequisites

Indeed protects the site with Cloudflare. The first run in a fresh
browser session may surface the `Just a moment…` interstitial, in which
case the adapter throws:

```
Indeed served a Cloudflare challenge page
hint: Open https://www.indeed.com in the connected browser and clear the
challenge, then retry.
```

Open the connected browser, complete the human check on `indeed.com` once,
and the cookies will carry forward into subsequent adapter calls
(`Strategy.COOKIE`).

## Limitations

- US site (`www.indeed.com`) only. Indeed runs region-specific subdomains
  (`uk.indeed.com`, `de.indeed.com`, ...) — adding them is mostly a
  question of swapping the origin and re-checking the DOM selectors.
- Salary parsing pulls the visible text without normalizing currencies or
  ranges. Pipe through your own normalizer if you need structured values.
- Tag column is a `·`-joined free-text list (job type, schedule, etc.);
  Indeed's metadata pills change wording per A/B bucket so don't expect a
  fixed taxonomy.
