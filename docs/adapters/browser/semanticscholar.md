# Semantic Scholar

**Mode**: 🌐 Public · **Domain**: `api.semanticscholar.org`

## Commands

| Command | Description |
|---------|-------------|
| `opencli semanticscholar paper <id-or-doi>` | Paper detail (citation graph + AI tldr) by paperId, DOI, or arXiv id |
| `opencli semanticscholar citations <id-or-doi>` | Papers that cite a given paper (paginated) |
| `opencli semanticscholar recommendations <id-or-doi>` | AI-curated related papers from Semantic Scholar's semantic graph |
| `opencli semanticscholar search <query>` | Search Semantic Scholar papers by free text |

## Usage Examples

```bash
# Paper detail by DOI (the BERT paper)
opencli semanticscholar paper 10.18653/v1/N19-1423

# Paper detail by arXiv id
opencli semanticscholar paper 1706.03762

# Citations of a paper, paginated
opencli semanticscholar citations 10.18653/v1/N19-1423 --limit 20
opencli semanticscholar citations 10.18653/v1/N19-1423 --limit 20 --offset 20

# AI-curated related papers (unique to Semantic Scholar)
opencli semanticscholar recommendations 10.18653/v1/N19-1423 --limit 10

# Free-text search
opencli semanticscholar search "attention is all you need" --limit 10

# JSON output
opencli semanticscholar paper 10.18653/v1/N19-1423 -f json
```

### `paper` Options

| Option | Description |
|--------|-------------|
| `id` (positional) | Semantic Scholar paperId (40-char hex), DOI, arXiv id, or a prefixed id such as `PMID:12345` / `ACL:N19-1423` / `MAG:...` / `CorpusId:...` |

Returns one row with `paperId, doi, title, year, firstAuthor, citationCount, influentialCitationCount, referenceCount, tldr, url`. The `paperId` and `doi` values round-trip into `citations` and `recommendations`.

### `citations` Options

| Option | Description |
|--------|-------------|
| `id` (positional) | Same id forms as `paper` |
| `--limit` | Max citing papers (1-1000, single Semantic Scholar page; default 20) |
| `--offset` | 0-based page offset for pagination (default 0; max 9999) |

Returns rows with `rank, paperId, doi, title, year, firstAuthor, citationCount, url`.

### `recommendations` Options

| Option | Description |
|--------|-------------|
| `id` (positional) | Same id forms as `paper` |
| `--limit` | Max recommendations (1-500, default 10) |

Returns rows with `rank, paperId, doi, title, year, firstAuthor, citationCount, url`. Uses Semantic Scholar's proprietary `recommendations/v1/papers/forpaper` endpoint, which has no equivalent in the existing arxiv / openalex / dblp / pubmed adapters.

### `search` Options

| Option | Description |
|--------|-------------|
| `query` (positional) | Full-text query |
| `--limit` | Max papers (1-100, default 20) |

Returns rows with `rank, paperId, doi, title, year, firstAuthor, citationCount, url`. Each `paperId` round-trips into `semanticscholar paper`.

## Prerequisites

- No browser required; uses the public Semantic Scholar API.
- The anonymous API caps at roughly 100 requests per 5 minutes. The adapter retries once on 429 with a short pause, and surfaces a typed `CommandExecutionError` after that.
- Set `SEMANTIC_SCHOLAR_API_KEY` to use a free API key (register at https://www.semanticscholar.org/product/api#api-key-form), which lifts the rate cap. The adapter forwards it as the `x-api-key` header; it works without a key.
