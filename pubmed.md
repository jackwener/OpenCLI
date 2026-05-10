# PubMed

**Mode**: 🌐 Public · **Domain**: `pubmed.ncbi.nlm.nih.gov`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pubmed search` | Search PubMed articles with filters |
| `opencli pubmed article` | Get article metadata and abstract by PMID |
| `opencli pubmed author` | Search articles by author and affiliation |
| `opencli pubmed citations` | List cited-by or reference relationships |
| `opencli pubmed related` | Find related PubMed articles |

## Usage Examples

```bash
# Search articles
opencli pubmed search "machine learning cancer" --year-from 2023 --has-abstract --limit 10

# Search by author
opencli pubmed author "Smith J" --position first --affiliation Harvard

# Read one article by PMID
opencli pubmed article 37780221 --full-abstract

# Citation relationships
opencli pubmed citations 37780221 --direction citedby --limit 20
opencli pubmed citations 37780221 --direction references --limit 20

# Related articles with scores
opencli pubmed related 37780221 --score
```

## Output

Listing commands return `pmid`, `title`, `authors`, `journal`, `year`, `article_type`, `doi`, and `url` where available. The `pmid` column is the stable identifier for `opencli pubmed article <pmid>`.

`article` returns field/value rows for title, authors, journal, year/date, DOI/PMC ID, MeSH terms, keywords, abstract, and PubMed URL.

## Prerequisites

- No browser required. Commands use the NCBI E-utilities public API.
- Optional: set `NCBI_API_KEY` for the higher NCBI rate limit.
- Optional: set `NCBI_EMAIL` so NCBI can identify your tool usage.

```bash
export NCBI_API_KEY=YOUR_API_KEY
export NCBI_EMAIL=you@example.com
```

## Failure Semantics

- Invalid `pmid`, `limit`, year, `sort`, `position`, or `direction` values fail before network access with `ArgumentError`.
- HTTP errors, fetch failures, invalid JSON, E-utilities error envelopes, and partial summary payloads fail with `CommandExecutionError`.
- Valid no-result searches and missing relationships fail with `EmptyResultError`.
