# wikipedia

## Commands

### random
- Purpose: Get a random Wikipedia article
- Args:
  - `lang`(optional; default: 'en'); Language code (e.g. en, zh, ja)
- Usage: `opencli wikipedia random [options] -f json`

### search
- Purpose: Search Wikipedia articles
- Args:
  - `query`(required); Search keyword
  - `limit`(optional; type: int; default: 10); Max results
  - `lang`(optional; default: 'en'); Language code (e.g. en, zh, ja)
- Usage: `opencli wikipedia search [options] -f json`

### summary
- Purpose: Get Wikipedia article summary
- Args:
  - `title`(required); Article title (e.g. "Transformer (machine learning model)")
  - `lang`(optional; default: 'en'); Language code (e.g. en, zh, ja)
- Usage: `opencli wikipedia summary [options] -f json`

### trending
- Purpose: Most-read Wikipedia articles (yesterday)
- Args:
  - `limit`(optional; type: int; default: 10); Max results
  - `lang`(optional; default: 'en'); Language code (e.g. en, zh, ja)
- Usage: `opencli wikipedia trending [options] -f json`
