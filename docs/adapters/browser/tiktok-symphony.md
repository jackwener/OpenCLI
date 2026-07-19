# TikTok Symphony Creative Studio

Drive **Symphony Creative Studio** image generation from the terminal. All commands run through your existing browser session — no API key needed.

**Mode**: 🔐 Browser · **Domain**: `ads.tiktok.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli tiktok-symphony credits` | Credit balance, plan and signed-in account | read |
| `opencli tiktok-symphony generations` | List generated assets in the Library | read |
| `opencli tiktok-symphony download <asset>` | Save a generated asset to a local file | read |
| `opencli tiktok-symphony generate <prompt>` | Generate images from a prompt and reference images | write |

`library` is an alias for `generations`.

## Usage Examples

```bash
# Sanity check — balance, plan, account
opencli tiktok-symphony credits

# Recent assets in the Library
opencli tiktok-symphony generations --limit 10

# Generate from a text prompt only
opencli tiktok-symphony generate "a minimal 3D mascot on a plain background"

# Generate using reference images (up to 4)
opencli tiktok-symphony generate "turn this into 3D chibi style" --refs ./cat.png,./dog.png

# Pick the model
opencli tiktok-symphony generate "detailed product shot" --model "Flux Kontext Max"

# Download an asset by id (from `generations`)
opencli tiktok-symphony download 202607195d0d7ea36ed139b74eccb1e4 --out ./downloads

# A full asset URL works too
opencli tiktok-symphony download "https://p16-ad-site-sign-sg.tiktokcdn.com/ad-creative-sg/...~tplv-...image?..."
```

## Options

### `generate`

| Option | Description |
|--------|-------------|
| `prompt` | What to generate (required positional) |
| `--refs` | Comma-separated reference image paths, max 4 (`.png` `.jpg` `.jpeg` `.webp` `.gif` `.avif`, 10 MB each) |
| `--model` | `Nano Banana` (default) or `Flux Kontext Max`; matching ignores case, spaces and dashes |
| `--timeout` | Max seconds to wait for rendering (default: `300`, min `30`) |

### `generations`

| Option | Description |
|--------|-------------|
| `--limit` | Max assets to list (default: `20`, max `200`) |

### `download`

| Option | Description |
|--------|-------------|
| `asset` | `assetId` from `generations`, or a full asset URL (required positional) |
| `--out` | Directory to write the file into (default: `.`) |

## Output Columns

| Command | Columns |
|---------|---------|
| `credits` | `credits, plan, account` |
| `generations` | `index, assetId, type, url` |
| `download` | `assetId, file, bytes, contentType` |
| `generate` | `index, assetId, url, model, prompt` |

## Prerequisites

- Chrome is running
- You are already signed into `ads.tiktok.com` (Symphony Creative Studio)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- One `generate` run produces up to 4 images; each returned row is one output asset
- `generate` is a **write** command — every run creates real assets on your account and can spend Symphony credits depending on your plan. Check `credits` first
- `generate` always reloads the composer before it starts: submitting does **not** clear the prompt or reference images, so reusing a dirty tab would silently resend them
- Reference images are attached through the composer's own drop zone. The page exposes no `input[type=file]`, so `--refs` reads each file and hands it to the page as a real drop
- Asset URLs are signed and short-lived, so `download` reads the live URL out of the Library rather than reconstructing it. If an `assetId` has scrolled out of the grid the command scrolls to find it
- The Library holds the full history; the in-app Create feed only keeps the last 3 days
- The DOM carries no generation id, so `assetId` comes from the asset's CDN path — that is the handle `generations` emits and `download` consumes
- `plan` and `account` return `null` rather than a string sentinel when the header cannot be read — branch on `null` in agent code
- `limit`, `timeout` and `refs` are validated and rejected with `ArgumentError` when out of range; no silent clamp
- Symphony is a client-rendered SPA whose header and composer hydrate after navigation — every command polls for readiness instead of assuming the DOM is present
