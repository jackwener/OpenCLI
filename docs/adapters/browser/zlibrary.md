# Z-Library

**Mode**: 🔐 Browser · **Domain**: `z-lib.id` (mirrors rotate; see below)

## Commands

| Command | Description |
|---------|-------------|
| `opencli zlibrary search <query>` | Search Z-Library books by title, author, ISBN, or keyword |
| `opencli zlibrary info <url>` | Read a Z-Library book page and list available PDF/EPUB download links |

## Mirrors

Z-Library moves between domains constantly, so `search` walks a mirror list and
stops at the first one that returns results:

`z-lib.id` → `z-library.sk` → `1lib.sk` → `z-library.im`

Override the list for a single call with `--mirror`, or globally with a
comma-separated environment variable (bare hosts or full `http(s)` origins):

```bash
# Try one specific mirror
opencli zlibrary search "asimov" --mirror z-library.sk

# Try several, in order
OPENCLI_ZLIBRARY_MIRROR=https://z-lib.id,https://z-library.sk opencli zlibrary search "asimov"
```

Unreachable mirrors are skipped as soon as the browser reports a connection
error (refused host, redirect loop, DNS failure), so a dead network reports
every attempt in a couple of seconds instead of hanging.

`info` accepts a book URL on any host shaped like a Z-Library mirror
(`z-lib.<tld>`, `z-library.<tld>`, `1lib.<tld>`, `booksc.<tld>`, `b-ok.<tld>`,
optionally behind one regional subdomain) or on a configured mirror. The shape
check is anchored, so lookalikes such as `z-lib.id.evil.com` or
`z-library.attacker.tld` are rejected; the TLD itself is not enumerated because
mirrors keep moving (`z-lib.ai`, `z-lib.fm`). Credentials in a pasted URL are
stripped from the returned `url`.

## Usage Examples

```bash
# Search books
opencli zlibrary search "machine learning" --limit 5

# Get book download formats from a result URL
opencli zlibrary info "https://z-lib.id/book/..."

# JSON output
opencli zlibrary search "9780131103627" -f json
```

## Prerequisites

- Chrome running and logged in to the mirror you use if the page requires
  authentication (`info` needs a session to expose download links).
- [Browser Bridge extension](/guide/browser-bridge) installed.
