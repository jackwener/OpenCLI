# MiniMax

**Mode**: 🔑 MiniMax API · **Contract**: stable public API · **Domain**: `api.minimax.io` / `api.minimaxi.com`

Generate music through MiniMax's documented Bearer-authenticated API. The
adapter does not use a browser session. Set `MINIMAX_API_KEY` to a key issued
for the selected deployment.

> [!IMPORTANT]
> MiniMax changed Music API availability on August 20, 2026. New users no
> longer receive the paid Music Generation API; existing paid / Token Plan
> users may continue using it. The `music-3.0-free` and `music-2.6-free` APIs
> have stopped, so this command exposes only `music-3.0` and `music-2.6`.

| `--region` | Endpoint | Official schema |
|------------|----------|-----------------|
| `global` (default) | `https://api.minimax.io/v1/music_generation` | [Global OpenAPI](https://platform.minimax.io/docs/api-reference/music/api/openapi.json) |
| `cn` | `https://api.minimaxi.com/v1/music_generation` | [China OpenAPI](https://platform.minimaxi.com/docs/api-reference/music/api/openapi.json) |

## Command

```text
opencli minimax music [prompt]
```

Generation can spend quota, so `--execute` is always required.

```bash
export MINIMAX_API_KEY=<your-api-key>

# Instrumental track; returns a 24-hour download URL
opencli minimax music "warm lo-fi piano, 80 BPM" \
  --instrumental --execute

# Vocal track with supplied lyrics
opencli minimax music "dream pop, shoegaze guitars" \
  --lyrics "[Verse]
Night rain on the window" \
  --audio-format wav --sample-rate 44100 --execute

# Ask MiniMax to generate lyrics from the prompt
opencli minimax music "anthemic stadium rock" \
  --lyrics-optimizer --execute

# Decode inline hex audio and atomically save it locally
opencli minimax music "ambient drone" \
  --instrumental --output-format hex --op ~/Music/minimax --execute

# China deployment with its optional AIGC watermark
opencli minimax music "国风古筝，慢板" \
  --instrumental --region cn --aigc-watermark --execute
```

## Inputs

| Option | Contract |
|--------|----------|
| `prompt` | Style, mood, and scenario; maximum 2000 characters |
| `--lyrics` | Structured lyrics; maximum 3500 characters |
| `--model` | `music-3.0` (default) or `music-2.6` |
| `--region` | `global` (default) or `cn` |
| `--output-format` | `url` (default) or `hex` |
| `--audio-format` | `mp3` (default), `wav`, or `pcm` |
| `--sample-rate` | `16000`, `24000`, `32000`, or `44100` |
| `--bitrate` | `32000`, `64000`, `128000`, or `256000` |
| `--instrumental` | Requires prompt; cannot be combined with lyrics or lyrics optimizer |
| `--lyrics-optimizer` | Allows vocal generation without lyrics when prompt is present |
| `--aigc-watermark` | Accepted only by `--region cn` |
| `--op` | Directory used only with `--output-format hex` |
| `--timeout` | HTTP timeout in seconds, 1–1800 (default 600) |
| `--execute` | Confirms the billable request |

Without `--instrumental`, supply `--lyrics`, or combine prompt with
`--lyrics-optimizer`. All arguments, credentials, and hex output preflight are
validated before the network request.

## Output

| Column | Description |
|--------|-------------|
| `status` | `completed`; incomplete responses fail instead of returning a row |
| `model` | Requested model |
| `region` | `global` or `cn` |
| `output_format` | `url` or `hex` |
| `audio_format` | `mp3`, `wav`, or `pcm` |
| `audio_url` | HTTPS URL for URL output, otherwise `null` |
| `file` | Saved path for hex output, otherwise `null` |
| `expires_in_hours` | `24` for URL output, otherwise `null` |

The non-streaming API returns `data.status` but no resumable task identity or
query endpoint. Therefore status `1` (in progress) is an error: the command
does not return a misleading success row and never automatically submits a
second billable request. A response `trace_id`, when present, is shown only as
diagnostic evidence; it is not a task ID.

A client timeout or network failure can occur after MiniMax accepted the
request. In that case result and billing state are unknown; check MiniMax
account history before retrying. URL output expires after 24 hours. Hex output
is decoded, size/signature checked when evidence is available, and published
from a same-directory staging file with an atomic no-clobber hard link. A
same-name lock is acquired before the billable request; collisions and failed
writes neither overwrite an existing track nor leave partial audio behind.
