# weread

## Commands

### book
- 用途：View book details on WeRead
- 参数：
  - `book-id`（必填）：Book ID (numeric, from search or shelf results)
- 用法：`opencli weread book [options] -f json`

### highlights
- 用途：List your highlights (underlines) in a book
- 参数：
  - `book-id`（必填）：Book ID (from shelf or search results)
  - `limit`（可选）：类型 int；默认值 20；Max results
- 用法：`opencli weread highlights [options] -f json`

### notebooks
- 用途：List books that have highlights or notes
- 参数：无
- 用法：`opencli weread notebooks [options] -f json`

### notes
- 用途：List your notes (thoughts) on a book
- 参数：
  - `book-id`（必填）：Book ID (from shelf or search results)
  - `limit`（可选）：类型 int；默认值 20；Max results
- 用法：`opencli weread notes [options] -f json`

### ranking
- 用途：WeRead book rankings by category
- 参数：
  - `category`（可选）：默认值 'all'；Category: all (default), rising, or numeric category ID
  - `limit`（可选）：类型 int；默认值 20；Max results
- 用法：`opencli weread ranking [options] -f json`

### search
- 用途：Search books on WeRead
- 参数：
  - `query`（必填）：Search keyword
  - `limit`（可选）：类型 int；默认值 10；Max results
- 用法：`opencli weread search [options] -f json`

### shelf
- 用途：List books on your WeRead bookshelf
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Max results
- 用法：`opencli weread shelf [options] -f json`
