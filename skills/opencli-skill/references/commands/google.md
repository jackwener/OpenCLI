# google

## Commands

### news
- Purpose: Get Google News headlines
- Args:
  - `keyword`(optional); Search query (omit for top stories)
  - `limit`(optional; type: int; default: 10); Number of results
  - `lang`(optional; default: 'en'); Language short code (e.g. en, zh)
  - `region`(optional; default: 'US'); Region code (e.g. US, CN)
- Usage: `opencli google news [options] -f json`

### search
- Purpose: Search Google
- Args:
  - `keyword`(required); Search query
  - `limit`(optional; type: int; default: 10); Number of results (1-100)
  - `lang`(optional; default: 'en'); Language short code (e.g. en, zh)
- Usage: `opencli google search [options] -f json`

### suggest
- Purpose: Get Google search suggestions
- Args:
  - `keyword`(required); Search query
  - `lang`(optional; default: 'zh-CN'); Language code
- Usage: `opencli google suggest [options] -f json`

### trends
- Purpose: Get Google Trends daily trending searches
- Args:
  - `region`(optional; default: 'US'); Region code (e.g. US, CN, JP)
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli google trends [options] -f json`
