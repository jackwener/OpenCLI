# dblp

**Mode**: 🌐 Public · **Domain**: `dblp.org`

[dblp](https://dblp.org) is the comprehensive computer-science bibliography maintained by Schloss Dagstuhl, indexing 7M+ publications across conferences, journals, books, and theses. Both commands hit the public API directly — no auth, no browser.

## Commands

| Command | Description |
|---------|-------------|
| `opencli dblp search <query>` | Free-text search across titles, authors, and venues |
| `opencli dblp paper <key>` | Fetch a single record's full metadata by canonical dblp key |

## Usage Examples

```bash
# Free-text search (matches title / author / venue)
opencli dblp search "attention is all you need" --limit 5

# Author search
opencli dblp search "Yoshua Bengio" --limit 20

# Venue search
opencli dblp search "ICLR 2024" --limit 30

# Single-record detail (round-trip from search.key)
opencli dblp paper conf/nips/VaswaniSPUJGKP17

# arXiv mirror records use the journals/corr/abs-* form
opencli dblp paper journals/corr/abs-2509-05821

# JSON output
opencli dblp search "graph neural network" -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, key, title, authors, venue, year, type, doi, url` |
| `paper` | `key, type, title, authors, venue, year, pages, doi, open_access_url, dblp_url` |

The `key` column from `search` round-trips into `paper` — it is dblp's canonical record identifier (e.g. `conf/nips/VaswaniSPUJGKP17`, `journals/corr/abs-2509-05821`, `phd/Smith20`).

## Type Tag

The `type` column is a single-token simplification of dblp's verbose type strings:

| Tag | Source |
|-----|--------|
| `conf` | Conference and Workshop Papers (`<inproceedings>`) |
| `journal` | Journal Articles (`<article>`) |
| `book` | Books and Theses |
| `editorship` | Proceedings volumes |
| `reference` | Reference Works |
| `preprint` | Informal / Other Publications (CoRR, etc.) |
| `incollection` / `phdthesis` / `mastersthesis` | (paper command only — kept distinct in the XML record) |

## Caveats

- dblp does **not** expose abstracts via either endpoint. For the abstract, follow `open_access_url` (when present), `doi`, or pipe the title into `arxiv search` / `openreview search`.
- Author names occasionally carry dblp's per-author homonym suffix (`"Smith 0001"`). The adapter strips trailing 4+ digit groups so you get clean `Author, Author` strings.
- Search results include CoRR / arXiv mirror entries. These have keys like `journals/corr/abs-2509-05821` and round-trip cleanly into `paper`.
- dblp throttles aggressive clients. If you hit HTTP 429, wait a few seconds and lower `--limit` (max 100 per page).

## Prerequisites

- No browser required — uses the public dblp API at `https://dblp.org`.
- The adapter sets a polite `User-Agent` per [dblp's API guidance](https://dblp.org/faq/How+to+use+the+dblp+search+API.html).
