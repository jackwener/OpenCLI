# Gutenberg

**Mode**: 🌐 Public · **Domain**: `www.gutenberg.org`

Browse Project Gutenberg ebooks, authors, rankings, categories, collections, and bookshelf search results without authentication.

## Commands

| Command                                     | Description |
|---------------------------------------------|-------------|
| `opencli gutenberg ebooks <id>`             | Show ebook metadata and download URLs for all available formats |
| `opencli gutenberg search [title]`          | Search ebooks by title or keyword |
| `opencli gutenberg author <id>`             | List books by a Gutenberg author |
| `opencli gutenberg hot-books`               | Show the top book rankings |
| `opencli gutenberg hot-author`              | Show the top author rankings |
| `opencli gutenberg main-categories`         | List the main Gutenberg book categories |
| `opencli gutenberg collections`             | List collections from the Reading Lists page |
| `opencli gutenberg categories`              | List Reading List categories |
| `opencli gutenberg category-search <query>` | Search Reading List categories |

## Usage examples

```bash
# Ebook details and available formats
opencli gutenberg ebooks 30849 -f json

# Search books by title or keyword
opencli gutenberg search "pride and prejudice" --sort downloads --limit 10 -f json

# List books by an author
opencli gutenberg author 69 --sort title -f json

# Browse popular books and authors
opencli gutenberg hot-books --period yesterday --limit 10 -f json
opencli gutenberg hot-author --period 7days --limit 10 -f json

# Browse categories and collections
opencli gutenberg main-categories -f json
opencli gutenberg collections -f json
opencli gutenberg categories --initial A -f json

# Search bookshelf categories
opencli gutenberg category-search \
  "Atheism | Buddhism | Christianity" \
  --sort quantity \
  -f json
```

## Options

### `search`

| Option | Description |
|--------|-------------|
| `title` (positional) | Optional book title or keyword |
| `--sort` | `title`, `downloads`, or `release_date`; default: `downloads` |
| `--limit` | Number of results from 1 to 100; default: 10 |

### `author`

| Option | Description |
|--------|-------------|
| `id` (positional) | Gutenberg author number, such as `69` |
| `--sort` | `title`, `downloads`, or `release_date`; default: `downloads` |

### `hot-books` and `hot-author`

| Option | Description |
|--------|-------------|
| `--limit` | Number of results from 1 to 100; default: 10 |
| `--period` | `yesterday`, `7days`, or `30days`; default: `yesterday` |

### `categories`

| Option | Description |
|--------|-------------|
| `--initial` | A single letter from A to Z; all categories are returned by default |

### `category-search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Category search query |
| `--sort` | `title`, `downloads`, `quantity`, or `release_date`; default: `downloads` |

## Output columns

| Command | Columns |
|---------|---------|
| `ebooks` | `id, title, author, summary, language, subjects, releaseDate, lastUpdate, copyright, downloads, readOnlineUrl, url, formats` |
| `search` | `id, title, author, url, downloads` |
| `author` | `id, title, author, url, downloads` |
| `hot-books` | `id, title, url` |
| `hot-author` | `id, name, url` |
| `main-categories` | `id, name, parentName, url` |
| `collections` | `name, url` |
| `categories` | `id, initial, name, url` |
| `category-search` | `name, downloads, url` |

## Notes

- All commands use public, server-rendered Gutenberg pages and do not require login or API credentials.
- Ebook identifiers and author identifiers must be positive integers. Full ebook URLs are also accepted by `ebooks`.
- Search and author results support sorting by `title`, `downloads`, or `release_date`.
- Category search supports sorting by `title`, `downloads`, `quantity`, or `release_date`.
- The `collections` command returns Gutenberg's collection order and does not expose a sort option.
- Download counts are returned as numbers when Gutenberg provides them.
- Empty results and malformed upstream responses are reported as command errors rather than successful incomplete rows.
