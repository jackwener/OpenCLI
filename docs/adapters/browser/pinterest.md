# Pinterest

**Mode**: 🔐 Browser · **Domain**: `pinterest.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pinterest search-pins` | Search pins on Pinterest |
| `opencli pinterest search-boards` | Search for boards on Pinterest |
| `opencli pinterest search-users` | Search for users on Pinterest |
| `opencli pinterest pin` | Get details of a Pinterest pin |
| `opencli pinterest user` | Get a Pinterest user's public profile stats |
| `opencli pinterest user-pins` | List pins created by a Pinterest user |
| `opencli pinterest user-boards` | List a user's boards |
| `opencli pinterest board-pins` | List pins inside a Pinterest board or board section |
| `opencli pinterest board-sections` | List the sections inside a Pinterest board |
| `opencli pinterest download` | Download the media of a pin, or of every pin on a board / board section |
| `opencli pinterest save` | Save a pin to your profile or a board |
| `opencli pinterest save-batch` | Save multiple pins to your profile or a board from a comma-separated pin list |
| `opencli pinterest pin-create` | Create a pin from an image URL or a local image file onto a board |
| `opencli pinterest pin-update` | Update a pin's title, description, alt text, or board |
| `opencli pinterest pin-update-batch` | Update or move multiple pins from a comma-separated pin list |
| `opencli pinterest pin-delete` | Delete one of your own pins |
| `opencli pinterest pin-delete-batch` | Delete multiple of your own pins from a comma-separated pin list |
| `opencli pinterest board-create` | Create a new board on your account |
| `opencli pinterest board-update` | Update the name, description, or privacy of your board, or archive it |
| `opencli pinterest board-delete` | Delete one of your own boards |
| `opencli pinterest board-section-create` | Create a section inside one of your boards |
| `opencli pinterest board-section-delete` | Delete a section from one of your boards |

## Usage Examples

### Read

```bash
# Search
opencli pinterest search-pins "nordic interior" --limit 10
opencli pinterest search-pins "sofa" --scope my_pins     # only your own pins (needs login)
opencli pinterest search-pins "sofa" --scope videos      # only video pins
opencli pinterest search-boards "coffee" --limit 10
opencli pinterest search-users "coffee" --limit 10

# A user's profile, pins, and boards
opencli pinterest user janedoe
opencli pinterest user-pins janedoe --limit 10
opencli pinterest user-boards janedoe --limit 50 --sort alphabetical
opencli pinterest user-boards janedoe --privacy secret    # your own secret boards

# A board's pins and sections
opencli pinterest board-pins janedoe/my-board --limit 10
opencli pinterest board-pins janedoe/my-board --section my-section    # one section
opencli pinterest board-pins janedoe/my-board --include-sections      # root + every section
opencli pinterest board-sections janedoe/my-board

# A single pin, and downloading media (images, mp4 videos, every slide of a carousel / story pin)
opencli pinterest pin 1234567890123456
opencli pinterest download 1234567890123456 --output ~/Downloads/pins
opencli pinterest download --board janedoe/my-board --section my-section --limit 100

# JSON output
opencli pinterest search-pins "coffee" -f json
```

Boards are addressed by `<username>/<slug>`, a board URL, or the numeric `boardId` from
`user-boards`; sections by their slug or id from `board-sections`.

### Paging through a long list

The commands that enumerate a collection — `board-pins`, `user-pins`, `user-boards`, and
`download --board` — take `--bookmark` and stamp each row with `nextBookmark`: the cursor for
the page after the last one fetched, or `""` at the end. Pass it back to continue where the
call stopped:

```bash
opencli pinterest board-pins janedoe/my-board --limit 100 -f json          # rows[0].nextBookmark
opencli pinterest board-pins janedoe/my-board --limit 100 --bookmark "<nextBookmark>" -f json
```

The cursor is opaque. Moving or deleting pins between calls shifts what a cursor points at, so
list everything first and act on the collected ids afterwards. The `search-*` commands have no
cursor; raise `--limit` instead.

### Write

```bash
# Save (repin) an existing pin — omit --board to save to your profile
opencli pinterest save 1234567890123456
opencli pinterest save 1234567890123456 --board janedoe/my-board --section my-section

# Create a pin from an image URL, or upload a local image file
opencli pinterest pin-create "https://example.com/image.jpg" \
  --board janedoe/my-board --title "My pin" --link "https://example.com"
opencli pinterest pin-create ./photo.jpg --board janedoe/my-board --alt-text "A red sofa"

# Update a pin (text, or move it to another board/section)
opencli pinterest pin-update 1234567890123456 --title "New title" --alt-text "A red sofa"
opencli pinterest pin-update 1234567890123456 --board janedoe/other-board --section my-section
opencli pinterest pin-update 1234567890123456 --board janedoe/my-board --section ""   # back to the board root

# The same for many pins at once (comma-separated ids or URLs, one row per pin)
opencli pinterest pin-update-batch 111,222,333 --board janedoe/my-board --section my-section
opencli pinterest save-batch 111,222,333 --board janedoe/my-board

# Boards and sections
opencli pinterest board-create "My board" --description "..." --privacy secret
opencli pinterest board-update janedoe/my-board --name "Renamed" --privacy public
opencli pinterest board-update janedoe/my-board --archive       # --unarchive to restore
opencli pinterest board-section-create janedoe/my-board --title "My section"
```

### Destructive commands

Deletes require `--confirm`. Without it the command prints what it *would* delete and exits
non-zero without touching anything.

```bash
opencli pinterest pin-delete 1234567890123456            # preview only
opencli pinterest pin-delete 1234567890123456 --confirm   # actually delete
opencli pinterest pin-delete-batch 111,222,333 --confirm  # many pins, one row each

opencli pinterest board-delete janedoe/my-board            # preview (shows the board's pin count)
opencli pinterest board-delete janedoe/my-board --confirm   # deletes the board *and its pins*

opencli pinterest board-section-delete janedoe/my-board --section my-section --confirm
```

## Notes

- **Reads work without logging in.** Search, pin, user, and board commands run fine on a
  logged-out Chrome session. Only the write commands need a Pinterest login; if the CSRF token
  is missing or stale, reload Pinterest in Chrome and retry.
- **`pin-create` takes a fetchable image URL or a local file.** Pinterest scrapes a URL
  server-side, so it must return the image itself — HTML page URLs and hotlink-protected hosts
  fail with `HTTP 400 ... check the URL`. Pinterest also derives its own description for scraped
  pins, so `--description` may be ignored. A local path (jpg, png, webp, gif, bmp, tiff; up to
  20 MB) is uploaded inline instead, which also covers images the scraper cannot reach.
- **Sections are only settable by a follow-up move.** Pinterest's create endpoints accept a
  section key, answer `HTTP 200`, and file the pin at the board root anyway; only
  `PinResource/update` honours it. So `save --section` and `pin-create --section` create the pin
  and then move it. If that second step fails, the command errors with the id of the pin it
  already created rather than reporting success.
- **Moving a pin with `--board` alone puts it on the board root.** That holds even when the pin
  already sits in a section of that same board, so `--board <its board>` (or the explicit
  `--section ""`) is how a pin leaves a section.
- **`*-batch` commands report per pin.** Each pin gets a row with `status` (`success` / `failed`)
  and `message`; one bad pin does not stop the rest. The command only exits non-zero when every
  pin failed. The board and section are resolved once, before any pin is touched.
- **List rows carry `link`, `domain`, `createdAt`, `mediaType`, and `altText`.** `mediaType` is
  `image`, `video`, `carousel`, or `story`. List rows do not say which section a pin is in —
  use `board-pins --section`, or `pin`, which reports `section` / `sectionId` along with
  `boardId` and `boardUrl` (both accepted by `--board`).
- **`download` prefers mp4 and needs yt-dlp for HLS-only videos.** When Pinterest serves a
  video solely as an HLS playlist, it is handed to `yt-dlp`; without `yt-dlp` installed that pin
  fails with a hint. Multi-image pins are saved as `<pinId>_<n>.<ext>`; carousel slides top out
  at the 736px rendition. With `--board`, a file that fails becomes a `failed` row (the reason
  is in `size`) and the rest continue.
- **Large calls.** `board-pins`, `user-pins` and `download --board` go up to `--limit 1000`
  (section feeds are fetched 50 pins per request). The `search-*` commands are slower and stop
  at 300 (`search-pins`) or 500 (`search-boards`, `search-users`) so one call stays inside the
  60s command timeout. `download` has its own `--timeout` (default 600s) for long board runs.
- **`--title ""`, `--description ""`, `--alt-text ""` clear the field.** Omitting a flag leaves
  the field alone, and passing an empty string clears it.
- **`save` without `--board`** posts a boardless repin, which Pinterest files under your
  profile's "Quick saves" board. `pin-create` cannot do this — creating a *new* pin always
  requires a board.
- **`user`'s `followingCount` includes topics.** It is Pinterest's own total, covering followed
  people *and* followed topics; `interestFollowingCount` is the topic-only part.
