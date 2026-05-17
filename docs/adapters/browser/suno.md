# Suno

**Mode**: 🔐 Browser · **Domain**: `suno.com`

Generate music with [Suno](https://suno.com) (V5.5 `chirp-fenix` by default) and download MP3 / M4A / WAV / cover / metadata via the user's logged-in Chrome session. Uses the `/api/generate/v2-web/` schema with Clerk Bearer auth + the `browser-token` / `device-id` headers Suno added in 2026-05.

## Commands

| Command | Description |
|---------|-------------|
| `opencli suno status` | Show login state, plan, credit breakdown, captcha readiness |
| `opencli suno list` | List recent clips in your library (id, title, status, created_at, link) |
| `opencli suno generate [prompt]` | Generate a song (Simple or Custom mode) and download clips locally |
| `opencli suno download <clip>` | Download an existing clip by UUID or `/song/<id>` URL |

Each `generate` request returns 2 candidate clips by design (Suno's native A/B). Both are downloaded.

## Usage Examples

```bash
# Quick health check — plan, credits, captcha
opencli suno status

# Browse the library (id you can feed to `download`)
opencli suno list --limit 20

# Simple mode — Suno picks lyrics, tags, and title
opencli suno generate "lo-fi study beat, 80 bpm, vinyl crackle" --instrumental true

# Custom mode — full control over lyrics, style, and exclusions
opencli suno generate \
  --lyrics "[Verse]\nNight rain on the window..." \
  --tags "synthwave, 100 BPM, analog pad" \
  --negative-tags "vocals, drums" \
  --title "Night Rain"

# Dial in the web UI's "Weirdness" + "Style Influence" sliders
opencli suno generate "post-rock crescendo" --weirdness 0.74 --style-weight 0.57

# Generate but skip the download (you only want the Suno links + clip ids)
opencli suno generate "ambient drone" --sd true

# Download an existing clip in MP3 + metadata (default)
opencli suno download a1b2c3d4-1111-2222-3333-444444444444

# Same, but also pull WAV (charged by Suno — must confirm)
opencli suno download a1b2c3d4-1111-2222-3333-444444444444 \
  --formats mp3,wav,metadata --confirm-paid true
```

## Options

| Option | Commands | Description |
|--------|----------|-------------|
| `prompt` | `generate` | Simple-mode description (positional, ignored when `--lyrics` is set) |
| `--lyrics` | `generate` | Custom-mode lyrics with `[Verse]` / `[Chorus]` metatags. Triggers Custom mode. |
| `--tags` | `generate` | Custom-mode style tags (genre, BPM, instruments). Used with `--lyrics`. |
| `--negative-tags` | `generate` | Custom-mode style exclusions (e.g. `"no vocals, no autotune"`). |
| `--title` | `generate` | Song title (default: auto-derived from prompt) |
| `--instrumental` | `generate` | No vocals (default: `false`) |
| `--model` | `generate` | `chirp-fenix` (V5.5, default), `chirp-bluejay` (V4.5+), `chirp-v4`, `chirp-v3-5` |
| `--weirdness` | `generate` | Creative weirdness slider, `0..1` (default: `0.5`) |
| `--style-weight` | `generate` | Style adherence slider, `0..1` (default: `0.5`) |
| `--timeout` | `generate` | Max seconds to wait for both clips to finish (default: `300`) |
| `--sd` | `generate` | Skip download; only print clip ids and Suno URLs |
| `clip` | `download` | Clip UUID or `https://suno.com/song/<id>` URL (positional, required) |
| `--limit` | `list` | Max clips to return (default: `20`) |
| `--page` | `list` | Pagination offset, 0-based (default: `0`) |
| `--formats` | `generate`, `download` | Comma-separated: `mp3`, `m4a`, `wav`, `video`, `cover`, `metadata` (default: `mp3,metadata`) |
| `--op` | `generate`, `download` | Output directory (default: `~/Music/suno`) |
| `--confirm-paid` | `generate`, `download` | Required for paid downloads (`wav`). Without it, paid formats are skipped with a warning. |

## Behavior

- **Two clips per generation.** Suno always returns 2 candidates per request (`A` and `B`). The adapter downloads both so the caller can A/B audition.
- **Paid-download guard.** `wav` is a paid download (Suno charges per `billing/clips/{id}/download/` call). Both `generate` and `download` skip `wav` by default and require `--confirm-paid true`. Skipped formats appear in the result row as `skipped(needs --confirm-paid):wav` rather than silently dropping.
- **Credit pre-check.** `generate` reads `/api/billing/info/` first and refuses to submit when total credits (monthly remaining + packs + leftover) are below `10` — no wasted requests.
- **Captcha pre-check.** `generate` and `status` hit `/api/c/check`; if Suno requires a challenge for the current account/IP, the command fails fast with instructions to solve a challenge once in the Chrome UI.
- **File naming.** `<sanitized-title>_<first-8-of-clip-uuid>.<ext>`, e.g. `Night Rain_a1b2c3d4.mp3`. A sibling `.json` carries the complete clip metadata from `/api/feed/v3` for downstream tooling.
- **Stems (12-track separation)** are not yet wired — the schema is known (`task: gen_stem`, `stem_type_id: 91`, `stem_task: twelve`) but stems are a paid extension that warrants its own command surface.

## Auth notes

The Suno studio API (`studio-api-prod.suno.com`) requires three things on every request: a Clerk JWT, an anti-replay `browser-token`, and a persistent `device-id`. The OpenCLI bridge's `credentials: 'include'` cross-origin fetch drops Suno's session cookie due to third-party-cookie isolation in the evaluate context, so this adapter explicitly reads `await window.Clerk.session.getToken()` and forwards it as `Authorization: Bearer`. `browser-token` is generated per request (a base64-encoded `{ timestamp }` object) and `device-id` is read from the `suno_device_id` cookie that Suno's frontend writes on first load.

## Prerequisites

- Chrome is running
- You are already logged into `suno.com`
- (For `generate`) The account has at least ~10 credits available (Pro plan default: 2,500/month)
