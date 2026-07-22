# Pinterest

**Mode**: 🔐 Browser · **Domain**: `www.pinterest.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pinterest create-pin` | Publish a new Pin through the logged-in Pinterest web UI |

## Usage

```bash
opencli pinterest create-pin \
  --image ./cover.jpg \
  --board "Ideas" \
  --title "Launch notes" \
  --description "A visual summary" \
  --link "https://example.com/post" \
  --alt-text "Notebook page with launch notes"
```

`create-pin` uses the visible Pinterest composer, uploads the local image,
selects the requested board, and clicks the final publish button. It does not
use the official Pinterest API.

## Prerequisites

- Chrome running and logged into `pinterest.com`
- Browser Bridge extension installed
- The target board already exists and is selectable in the account
- Browser Bridge file upload support

If Pinterest shows a verification challenge, captcha, disabled publish button,
or account restriction, the command stops and reports the failure instead of
trying to bypass it.
