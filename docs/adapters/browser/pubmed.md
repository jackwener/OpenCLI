# PubMed

**Mode**: 🌐 Public · **Domain**: `pubmed.ncbi.nlm.nih.gov`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pubmed search` | Search PubMed articles with advanced filters |
| `opencli pubmed article` | Get detailed article metadata by PMID |
| `opencli pubmed author` | Search by author name and affiliation |
| `opencli pubmed citations` | Get citation relationships |
| `opencli pubmed related` | Find semantically similar articles |

## Usage Examples

```bash
# Search for articles
opencli pubmed search "machine learning cancer" --year-from 2023 --has-abstract

# Get article details by PMID
opencli pubmed article 37780221

# Get full abstract without truncation
opencli pubmed article 37780221 --full-abstract

# JSON output
opencli pubmed search "COVID-19 treatment" -f json

# Find related articles with similarity scores
opencli pubmed related 37780221 --score

# Citation analysis
opencli pubmed citations 37780221 --direction citedby --limit 50
```

## Prerequisites

- No browser required — uses NCBI E-utilities public API
- Optional: Set `NCBI_API_KEY` environment variable for higher rate limits (10 req/s vs 3 req/s)

## Rate Limits

| Without API Key | With API Key |
|-----------------|--------------|
| 3 requests/second | 10 requests/second |

### Getting an NCBI API Key

1. Create an NCBI account at https://www.ncbi.nlm.nih.gov/account/
2. Go to https://www.ncbi.nlm.nih.gov/account/settings/
3. Generate an API key

### Configuring Your API Key

```bash
export NCBI_API_KEY=YOUR_API_KEY
export NCBI_EMAIL=your@email.com
```
