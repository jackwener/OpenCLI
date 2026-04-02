# tieba

## Commands

### hot
- Purpose: Tieba hot topics
- Args:
  - `limit`(optional; type: int; default: 20); Number of items to return
- Usage: `opencli tieba hot [options] -f json`

### posts
- Purpose: Browse posts in a tieba forum
- Args:
  - `forum`(required; type: string); Forum name in Chinese
  - `page`(optional; type: int; default: 1); Page number
  - `limit`(optional; type: int; default: 20); Number of items to return
- Usage: `opencli tieba posts [options] -f json`

### read
- Purpose: Read a tieba thread
- Args:
  - `id`(required; type: string); Thread ID
  - `page`(optional; type: int; default: 1); Page number
  - `limit`(optional; type: int; default: 30); Number of replies to return
- Usage: `opencli tieba read [options] -f json`

### search
- Purpose: Search posts across tieba
- Args:
  - `keyword`(required; type: string); Search keyword
  - `page`(optional; type: int; default: 1); Page number (currently only 1 is supported)
  - `limit`(optional; type: int; default: 20); Number of items to return
- Usage: `opencli tieba search [options] -f json`
