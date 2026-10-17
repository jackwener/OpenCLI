# TikTok Symphony Creative Studio

Drive **Symphony Creative Studio** image and video generation from the terminal. All commands run through your existing browser session — no API key needed.

**Mode**: 🔐 Browser · **Domain**: `ads.tiktok.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli tiktok-symphony credits` | Credit balance, plan and signed-in account | read |
| `opencli tiktok-symphony generations` | List generated assets in the Library | read |
| `opencli tiktok-symphony jobs` | Show generations in the Create feed with render progress | read |
| `opencli tiktok-symphony download <asset>` | Save a generated asset to a local file | read |
| `opencli tiktok-symphony generate <prompt>` | Generate images from a prompt and reference images | write |
| `opencli tiktok-symphony generate-video <prompt>` | Render a video clip | write |
| `opencli tiktok-symphony delete <asset>` | Permanently delete a generation | write |

Aliases: `library` → `generations`, `queue` → `jobs`, `video` → `generate-video`, `rm` → `delete`.

## Usage Examples

```bash
# Sanity check — balance, plan, account
opencli tiktok-symphony credits

# Recent assets in the Library
opencli tiktok-symphony generations --limit 10

# Generate images from a text prompt only
opencli tiktok-symphony generate "a minimal 3D mascot on a plain background"

# Generate using reference images (up to 4)
opencli tiktok-symphony generate "turn this into 3D chibi style" --refs ./cat.png,./dog.png

# Video, text only
opencli tiktok-symphony generate-video "a paper boat drifting on a puddle, macro shot"

# Video from one image (that image becomes the first frame)
opencli tiktok-symphony generate-video "gentle camera push in" --refs ./hero.png --duration 10

# Video between two frames
opencli tiktok-symphony generate-video "morph between the two" \
  --mode image --frames first-last --refs ./start.png,./end.png

# Video that blends several references into one scene
opencli tiktok-symphony generate-video "the character walks through the scene" \
  --mode reference --refs ./character.png,./scene.png

# Watch what is still rendering
opencli tiktok-symphony jobs --pending true

# Download an asset by id (from `generations`)
opencli tiktok-symphony download 202607195d0d7ea36ed139b74eccb1e4 --out ./downloads

# Delete — dry run first, then for real
opencli tiktok-symphony delete 202607195d0d7ea36ed139b74eccb1e4
opencli tiktok-symphony delete 202607195d0d7ea36ed139b74eccb1e4 --yes
```

## Options

### `generate`

| Option | Description |
|--------|-------------|
| `prompt` | What to generate (required positional) |
| `--refs` | Comma-separated reference image paths, max 4 (`.png` `.jpg` `.jpeg` `.webp` `.gif` `.avif`, 10 MB each) |
| `--model` | `Nano Banana` (default) or `Flux Kontext Max`; matching ignores case, spaces and dashes |
| `--timeout` | Max seconds to wait for rendering (default: `300`, min `30`) |

### `generate-video`

| Option | Description |
|--------|-------------|
| `prompt` | What to generate (required positional) |
| `--mode` | `text`, `image`, `reference`, or `auto` (default) — auto picks `text` with no refs, `image` with one, `reference` with two or more |
| `--refs` | Comma-separated reference image paths (`image`: 1–2, `reference`: 1–4) |
| `--frames` | `first` (default) or `first-last`; `--mode image` only, and `first-last` needs exactly two refs |
| `--model` | `Video 1.5 Pro` (the only model the Video tab offers) |
| `--duration` | `5` / `10` / `12` seconds, with or without the `s` (default: `5`) |
| `--wait` | Block until the clip renders (default: `false`) |
| `--timeout` | Max seconds to wait when `--wait true` (default: `5400`, min `60`) |

### `generations`

| Option | Description |
|--------|-------------|
| `--limit` | Max assets to list (default: `20`, max `200`) |

### `jobs`

| Option | Description |
|--------|-------------|
| `--limit` | Max cards to list (default: `20`, max `50`) |
| `--pending` | Only cards that have not produced an output yet (default: `false`) |

### `download`

| Option | Description |
|--------|-------------|
| `asset` | `assetId` from `generations`, or a full asset URL (required positional) |
| `--out` | Directory to write the file into (default: `.`) |

### `delete`

| Option | Description |
|--------|-------------|
| `asset` | `assetId` from `generations` (required positional) |
| `--yes` | Actually delete. Without it the asset is only located and reported as `dry-run` |

## Output Columns

| Command | Columns |
|---------|---------|
| `credits` | `credits, plan, account` |
| `generations` | `index, assetId, type, url` |
| `jobs` | `index, status, progress, taskId, model, prompt, error` |
| `download` | `assetId, file, bytes, contentType` |
| `generate` | `index, assetId, url, model, prompt` |
| `generate-video` | `index, status, assetId, url, mode, model, duration, prompt` |
| `delete` | `assetId, status, type, url` |

## Prerequisites

- Chrome is running
- You are already signed into `ads.tiktok.com` (Symphony Creative Studio)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

### Cost and timing

- `generate` is a **write** command — every run creates real assets on your account. One run produces up to 4 images; each returned row is one output asset
- `generate-video` charges **one credit per second of clip**: a 5s clip costs 5, a 12s clip costs 12. A rejected render is charged too. Check `credits` first
- Video rendering takes **tens of minutes** — over an hour has been observed, despite the on-screen "Check back in 5–10 minutes". That is why `--wait` defaults to `false`: the job is submitted, the row comes back as `status: generating`, and `jobs` or `generations` picks it up later

### Reading job state

- `jobs` reports four states and never guesses: `failed` (the card carries an error code), `ready` (an output is actually mounted), `generating` (a percentage is showing), and `finishing` — no percentage and no output yet. Losing the percentage is **not** completion; the site sits on "Almost there…" for a long stretch before the clip appears. A finished card scrolled out of view also reads as `finishing`, so treat `generations` as the authority on what exists
- A render can be **rejected by moderation**. The failure arrives as ordinary card text with a task id and an error code — no dialog, no HTTP error. `generate-video --wait true` raises it as a `CommandExecutionError` instead of waiting forever, and `jobs` surfaces it in the `error` column. This is the only place the site exposes a real generation id

### Assets

- Clips and images live on **different CDNs with different identities**: an image is an `<img>` on `ad-creative-sg` identified by a path segment, a clip is a `<video>` on `v16-ad-creative.tiktokcdn-row.com` identified by its `vid` query parameter. `generations` reports both, and `type` comes from the element kind rather than the tile badge, which is localized and absent on clip tiles
- Asset URLs are signed and short-lived, so `download` reads the live URL out of the Library rather than reconstructing it. If an `assetId` has scrolled out of the grid the command scrolls to find it
- The Library holds the full history; the in-app Create feed only keeps the last 3 days and a handful of cards
- `delete` is irreversible and therefore **dry-run by default** — pass `--yes` to actually delete. It confirms the site's dialog and then waits for the tile to leave the grid before reporting `deleted`. Despite the dialog wording ("this generation"), one tile is one asset: deleting an image leaves its siblings from the same run in place

### Driving the page

- These commands default to a **foreground window**. Library and feed tiles mount lazily through `IntersectionObserver`, and a background tab is never rendered, so nothing ever intersects and the grid stays empty
- Reference images are attached through the composer's own drop zone. The page exposes no `input[type=file]`, so `--refs` reads each file and hands it to the page as a real drop. The base64 is transferred in chunks — a single ~1 MB `evaluate` argument exceeds what the browser bridge will carry
- Each Video mode is its own `subApp` URL, so `generate-video` navigates straight to the mode instead of clicking the mode dropdown
- `generate` always reloads the composer before it starts: submitting does **not** clear the prompt or reference images, so reusing a dirty tab would silently resend them
- Symphony is a client-rendered SPA whose header and composer hydrate after navigation — every command polls for readiness instead of assuming the DOM is present
- `plan` and `account` return `null` rather than a string sentinel when the header cannot be read — branch on `null` in agent code
- `limit`, `timeout`, `duration`, `mode`, `frames` and `refs` are validated and rejected with `ArgumentError` when out of range; no silent clamp, and no silent fallback to a default model
