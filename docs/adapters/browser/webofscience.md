# Web of Science

**Mode**: 🔐 Browser · **Domain**: `webofscience.clarivate.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli webofscience smart-search` | Search Web of Science records from `woscc` or `alldb` through Smart Search |
| `opencli webofscience basic-search` | Search Web of Science through the Basic Search page |
| `opencli webofscience author-search` | Search Web of Science researcher profiles |
| `opencli webofscience author-record` | Fetch a Web of Science researcher author record by id or URL |
| `opencli webofscience citing-articles` | List articles citing a Web of Science record |
| `opencli webofscience references` | List cited references for a Web of Science record |
| `opencli webofscience record` | Fetch a full record by UT, DOI, or full-record URL |

## Usage Examples

```bash
# Quick start
opencli webofscience smart-search "machine learning" --limit 5

# Search across all databases
opencli webofscience smart-search "machine learning" --database alldb --limit 5

# Use the basic-search entrypoint
opencli webofscience basic-search "graph neural networks" --database woscc

# Restrict basic-search to a specific field
opencli webofscience basic-search "machine learning" --field title
opencli webofscience basic-search "Yann LeCun" --field author
opencli webofscience basic-search "10.1016/j.patter.2024.101046" --field doi

# Search researcher profiles
opencli webofscience author-search "Jane Doe"

# Refine researcher profiles by claimed status and facets
opencli webofscience author-search "Yann LeCun" --claimed-status claimed --affiliation Meta
opencli webofscience author-search "Yann LeCun" --country USA --category "Computer Science"
opencli webofscience author-search "Yann LeCun" --author "Yann LeCUN"
opencli webofscience author-search "Yann LeCun" --award-year 2024 --award-category NSF

# Fetch a full record by UT
opencli webofscience record WOS:001335131500001

# Fetch a full record by DOI from all databases
opencli webofscience record 10.1016/j.patter.2024.101046 --database alldb

# Fetch author details by author-record id
opencli webofscience author-record 89895674

# Fetch citing articles or cited references
opencli webofscience citing-articles WOS:001335131500001 --limit 5
opencli webofscience references WOS:001335131500001 --limit 5

# JSON output
opencli webofscience smart-search "graph neural networks" -f json

# Verbose mode
opencli webofscience smart-search "causal inference" -v
```

## Output Fields

- `rank`
- `title`
- `authors`
- `year`
- `source`
- `citations`
- `doi`
- `url`

`author-search` returns `rank`, `name`, `details`, `affiliations`, `location`, `researcher_id`, `published_names`, `top_journals`, and the author profile URL.

`author-search` supports researcher-result refine filters through `--claimed-status`, `--author`, `--affiliation`, `--country`, `--category`, `--award-year`, and `--award-category`. These accept the labels shown in the current results page facets; multi-value filters can be passed as comma- or semicolon-separated lists.

`basic-search` supports `--field` with the Web of Science Basic Search field set, including `topic`, `all-fields`, `title`, `author`, `publication-titles`, `year-published`, `affiliation`, `funding-agency`, `publisher`, `publication-date`, `abstract`, `accession-number`, `address`, `author-identifiers`, `author-keywords`, `conference`, `document-type`, `doi`, `editor`, `grant-number`, `group-author`, `keyword-plus`, `language`, `pubmed-id`, and `web-of-science-categories`.

`record` returns `field` / `value` rows, including title, authors, abstract, UT, DOI, document type, publication/indexing metadata, corresponding address, author addresses, email addresses, research areas, Web of Science categories, `authors_structured`, citation counts, full-text link labels/URLs, and the full-record URL when available.

`author-record` returns `field` / `value` rows for researcher profile metadata, including name, display name, affiliations, location, ResearcherID, published names, subject categories, key metrics, co-authors, and the publications summary URL when available.

`citing-articles` and `references` return the same structured list fields as `smart-search`, but scoped to a seed record's citation network.

## Prerequisites

- Chrome running with access to your Web of Science institution/subscription
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- The adapter uses the Smart Search page, then replays the underlying `runQuerySearch` request for structured results.
- `basic-search` reuses the same structured search backend, but starts from the Basic Search page instead of Smart Search.
- `author-search` uses browser-driven page interaction for both the autocomplete search form and the researcher results refine facets. It supports the same visible filters exposed by the result page, including claimed status, author, affiliation, country/region, Web of Science categories, and award-related facets when Web of Science exposes them for the current result set.
- `author-record` uses the author profile page directly and extracts the fields that are only visible on the profile page.
- `citing-articles` and `references` navigate to the corresponding Web of Science summary pages, then replay the summary query through the in-page search state that Web of Science stores in browser storage.
- `record` performs an exact search first to establish a query session, then requests `getFullRecordByQueryId` for the matching document.
- `record` also opens the full-record page to enrich the output with page-only fields such as full-text links and publication metadata that are not always present in the structured API payload.
- Web of Science may trigger passive verification before the first search. The adapter retries once automatically when the initial session is not ready.
