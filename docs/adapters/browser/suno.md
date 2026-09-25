# Suno

**Mode**: 🔐 Browser · **Domain**: `suno.com`

Generate music with [Suno](https://suno.com) (v6, v6-wild, or v6-mini) and download MP3 / M4A / WAV / cover / metadata via the user's logged-in Chrome session. The adapter reads the model's API key and account entitlement from `/api/billing/info/`, then uses `/api/generate/v2-web/` or the official Create form when webpage verification is required.

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

# Dial in the web UI's "Weirdness" + "Style Influence" sliders in Advanced mode
opencli suno generate --lyrics "[Verse] The lights are fading" \
  --tags "post-rock crescendo" --weirdness 0.74 --style-weight 0.57

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
| `--model` | `generate` | `v6` (Pro/Premier), `v6-wild` (Pro/Premier), `v6-mini` (all plans). Default: account default. |
| `--weirdness` | `generate` | Creative weirdness slider, `0..1` (default: `0.5`) |
| `--style-weight` | `generate` | Style adherence slider, `0..1` (default: `0.5`) |
| `--timeout` | `generate` | Max seconds to wait for both clips to finish (default: `300`) |
| `--sd` | `generate` | Skip download; only print clip ids and Suno URLs |
| `--via-ui` | `generate` | Use the official Create form even when verification is not currently required. Useful when the direct API intermittently asks for webpage verification. |
| `clip` | `download` | Clip UUID or `https://suno.com/song/<id>` URL (positional, required) |
| `--limit` | `list` | Max clips to return (default: `20`) |
| `--page` | `list` | Pagination offset, 0-based (default: `0`) |
| `--formats` | `generate`, `download` | Comma-separated: `mp3`, `m4a`, `wav`, `video`, `cover`, `metadata` (default: `mp3,metadata`) |
| `--op` | `generate`, `download` | Output directory (default: `~/Music/suno`) |
| `--confirm-paid` | `generate`, `download` | Required for paid downloads (`wav`). Without it, paid formats are skipped with a warning. |

## Behavior

- **Two clips per generation.** Suno always returns 2 candidates per request (`A` and `B`). The adapter downloads both so the caller can A/B audition.
- **Download guard and quota.** `wav` is an extra paid download (Suno charges per `billing/clips/{id}/download/` call). Both `generate` and `download` skip `wav` by default and require `--confirm-paid true`. Skipped formats appear as `skipped(needs --confirm-paid):wav`. Standard downloads are also subject to [Suno's plan limits](https://suno.com/blog/suno-updates-tos).
- **Credit pre-check.** `generate` reads `/api/billing/info/` first and refuses to submit when total credits (monthly remaining + packs + leftover) are below `10` — no wasted requests.
- **Webpage verification.** `status` and default `generate` check `/api/c/check`; `--via-ui true` uses Create without depending on that probe. `required=true` or an unavailable check routes default generation to Create, where the page may complete verification itself. The fallback prepares the requested v6 model and Simple or Advanced inputs, clicks Create once, binds the response to the new clips, then verifies the requested title and continues polling/downloading. For a Simple instrumental request, the current Create UI has no instrumental toggle, so the fallback uses Advanced with the description as styles and empty lyrics. No verification tokens are extracted, fabricated, or replayed.
- **Fallback limits and uncertain writes.** Simple vocal mode has no slider controls: if webpage verification is required, a Simple prompt with nondefault sliders fails before submission; use Advanced lyrics and styles instead. Advanced sliders use 1% steps; values between those steps also fail before submission. A visible human challenge is left for the user. Both the direct API and Create paths use invocation-specific `sessionStorage` guards so browser execution cannot submit twice. An uncertain result is never automatically retried. Inspect `opencli suno list` / the retained Create tab before another generation; if the direct API was clearly rejected by verification, use `--via-ui true` instead of manually making a sacrificial song. Use `--keep-tab true --window foreground` when a human handoff may be needed.
- **File naming.** `<sanitized-title>_<first-8-of-clip-uuid>.<ext>`, e.g. `Night Rain_a1b2c3d4.mp3`. A sibling `.json` carries the complete clip metadata from `/api/feed/v3` for downstream tooling.
- **Stems (12-track separation)** are not yet wired — the schema is known (`task: gen_stem`, `stem_type_id: 91`, `stem_task: twelve`) but stems are a paid extension that warrants its own command surface.

## Auth notes

The Suno studio API (`studio-api-prod.suno.com`) requires a session JWT, an anti-replay `browser-token`, and a persistent `device-id`. The OpenCLI bridge's `credentials: 'include'` cross-origin fetch can omit Suno's session cookie, so the adapter refreshes through Clerk when that runtime is present, otherwise reads the first-party `__session` cookie, and forwards the JWT as `Authorization: Bearer`. `browser-token` is generated per request (a base64-encoded `{ timestamp }` object); `device-id` comes from the `suno_device_id` cookie.

## Prerequisites

- Chrome is running
- You are already logged into `suno.com`
- (For `generate`) The account has at least ~10 credits available (Pro plan default: 2,500/month)
