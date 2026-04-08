# weread

## Commands

### book
- Purpose: View book details on WeRead
- Args:
  - `book-id`(required); Book ID from search or shelf results
- Usage: `opencli weread book [options] -f json`

### highlights
- Purpose: List your highlights (underlines) in a book
- Args:
  - `book-id`(required); Book ID (from shelf or search results)
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli weread highlights [options] -f json`

### notebooks
- Purpose: List books that have highlights or notes
- Args: None
- Usage: `opencli weread notebooks [options] -f json`

### notes
- Purpose: List your notes (thoughts) on a book
- Args:
  - `book-id`(required); Book ID (from shelf or search results)
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli weread notes [options] -f json`

### ranking
- Purpose: WeRead book rankings by category
- Args:
  - `category`(optional; default: 'all'); Category: all (default), rising, or numeric category ID
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli weread ranking [options] -f json`

### search
- Purpose: Search books on WeRead
- Args:
  - `query`(required); Search keyword
  - `limit`(optional; type: int; default: 10); Max results
- Usage: `opencli weread search [options] -f json`

### shelf
- Purpose: List books on your WeRead bookshelf
- Args:
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli weread shelf [options] -f json`
