# arxiv

## Commands

### paper
- Purpose: Get arXiv paper details by ID
- Args:
  - `id`(required); arXiv paper ID (e.g. 1706.03762)
- Usage: `opencli arxiv paper [options] -f json`

### search
- Purpose: Search arXiv papers
- Args:
  - `query`(required); Search keyword (e.g. "attention is all you need")
  - `limit`(optional; type: int; default: 10); Max results (max 25)
- Usage: `opencli arxiv search [options] -f json`
