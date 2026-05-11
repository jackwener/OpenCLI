# OpenAlex

**Mode**: 🌐 Public · **Domain**: `api.openalex.org`

Search and inspect scholarly Works (papers, preprints, books) on OpenAlex without auth or browser. Two commands.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openalex search <query>` | Search OpenAlex Works by keyword |
| `opencli openalex work <id>` | Single Work — metadata + reconstructed abstract |

## Usage Examples

```bash
# Free-text search
opencli openalex search transformers --limit 10
opencli openalex search "open access scholarly" --limit 5

# Single Work by OpenAlex id (use `id` from search rows)
opencli openalex work W2741809807

# Single Work by DOI (raw or full URL)
opencli openalex work 10.7717/peerj.4375
opencli openalex work https://doi.org/10.7717/peerj.4375

# JSON output
opencli openalex search transformers -f json
opencli openalex work W2741809807 -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, title, year, citations, firstAuthor, venue, openAccess, type, doi, url` |
| `work`   | `id, title, type, year, date, language, authors, venue, citations, openAccess, openAccessUrl, referencedCount, doi, abstract, url` |

The `id` column from `search` round-trips into `work` exactly. `work` accepts an OpenAlex Work id, a raw DOI, or any `openalex.org` / `doi.org` URL.

## Options

### `openalex search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search text |
| `--limit` | Max Works (1-200, default: 20) |

### `openalex work`

| Option | Description |
|--------|-------------|
| `id` (positional) | OpenAlex Work id (`W2741809807`), DOI (`10.7717/peerj.4375`), or full URL |

## Caveats

- Work id input is validated upfront — only `W…` IDs / DOIs / `openalex.org` / `doi.org` URLs are accepted; OpenAlex itself does the canonicalization for DOIs. Bad input raises `ArgumentError`.
- The `abstract` column is reconstructed from OpenAlex's `abstract_inverted_index` (token → positions) — this is how OpenAlex distributes abstracts for licensing reasons. It's the verbatim abstract text.
- Set `OPENALEX_MAILTO=you@example.com` to opt into the OpenAlex polite pool (faster + more reliable). Optional — anonymous requests still work.
- OpenAlex `select=` rejects unknown fields. The adapter pins a vetted field list (`primary_location`, `open_access`, `authorships`, etc.) to avoid passing aliases that 400.
- OpenAlex throttles unauthenticated traffic; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.

## Prerequisites

- No browser required — uses `api.openalex.org/works`.
