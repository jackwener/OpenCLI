# Z-Library App (Z-Library 桌面版)

Control the **Z-Library Desktop App** via Chrome DevTools Protocol (CDP): book search, booklist management, and streamed downloads.

## Prerequisites

1. Install the [Z-Library Desktop app](https://library-access.sk/) and sign in.
2. Register the app in `~/.opencli/apps.yaml` (create the file if missing):

   ```yaml
   apps:
     zlibrary-app:
       port: 9230
       processName: Z-Library
       bundleId: zlibrary
       displayName: Z-Library
   ```

3. Launch the app with remote debugging enabled (or let the launcher do it):

   ```bash
   /Applications/Z-Library.app/Contents/MacOS/Z-Library --remote-debugging-port=9230
   ```

4. Prefer HTTPS content targets over the `file://` loader shell:

   ```bash
   export OPENCLI_CDP_TARGET='https://'
   # or a per-command alias:
   # alias zlibrary-app='OPENCLI_CDP_TARGET=https:// opencli zlibrary-app'
   ```

   The Desktop app is a multi-view Electron shell: CDP exposes several
   `file://` loader pages plus the real `https://` content tabs. The
   `OPENCLI_CDP_TARGET` preference makes commands bind to content pages.

## Commands

| Command | Description |
|---------|-------------|
| `opencli zlibrary-app status` | Check the active CDP connection (app, page URL, title) |
| `opencli zlibrary-app search <query>` | Search books with language/extension/content-type/year/regex filters and pagination |
| `opencli zlibrary-app info <url>` | Show available download formats for a book |
| `opencli zlibrary-app list-languages` | List supported language codes and display names |
| `opencli zlibrary-app download <url>` | Download a book file via the app's CDP Fetch stream |
| `opencli zlibrary-app download-history` | List your download history |
| `opencli zlibrary-app profile-read` | Show account info, daily quota, MD5 filename-format status |
| `opencli zlibrary-app profile-set-md5` | Enable MD5 hash in download filename format |
| `opencli zlibrary-app quota-status` | Show daily download quota (persistent ledger + live DOM) |
| `opencli zlibrary-app booklist-create` | Create a booklist (optionally populate it) |
| `opencli zlibrary-app booklist-list` | List your booklists |
| `opencli zlibrary-app booklist-show` | Show a booklist's metadata and books |
| `opencli zlibrary-app booklist-add` | Add books to a booklist from search or the current page |
| `opencli zlibrary-app booklist-manage` | Add/delete a book, or append search results |
| `opencli zlibrary-app booklist-delete` | Delete a booklist (requires `--force`) |
| `opencli zlibrary-app booklist-import` | Import books from a JSON file into a booklist |
| `opencli zlibrary-app booklist-export` | Export a booklist to JSON |
| `opencli zlibrary-app booklist-download` | Batch download all books in a booklist |
| `opencli zlibrary-app doctor` | Adapter diagnostics: probe selectors or validate local fixtures |

## How It Works

Connects to the Z-Library Electron app via CDP and drives the signed-in
content tabs. Downloads intercept the app's `/dl/` request with the CDP
Fetch domain, stream the body through `IO.read` into a temp artifact, then
ingest it with MIME sniffing, MD5 verification, and HTML block-page
detection. Booklist commands reuse the app's authenticated session for its
booklist APIs.

## Limitations

- Requires the Desktop app running with `--remote-debugging-port=9230`
- Requires `OPENCLI_CDP_TARGET='https://'` (or the alias above) so commands
  bind to content pages instead of the loader shell
- Tested on macOS (app v2.1.2); Windows/Linux builds should work the same
  way but are untested
- Daily download quota is enforced by Z-Library; the adapter reports it but
  does not bypass it
