# YouTube

**Mode**: 🔐 Browser · **Domain**: `youtube.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli youtube search` | Search videos |
| `opencli youtube video` | Get video metadata |
| `opencli youtube transcript` | Get video transcript/subtitles |
| `opencli youtube comments` | Get video comments |
| `opencli youtube channel` | Get channel info and videos |
| `opencli youtube playlist` | Get playlist video list |
| `opencli youtube feed` | Homepage recommended videos |
| `opencli youtube history` | Watch history |
| `opencli youtube watch-later` | Watch Later queue |
| `opencli youtube subscriptions` | List subscribed channels |
| `opencli youtube like` | Like a video |
| `opencli youtube unlike` | Remove like from a video |
| `opencli youtube subscribe` | Subscribe to a channel |
| `opencli youtube unsubscribe` | Unsubscribe from a channel |
| `opencli youtube comment` | Post a top-level comment on a video (requires `--execute`) |

## Usage Examples

```bash
# Read commands
opencli youtube feed --limit 10
opencli youtube history --limit 20
opencli youtube watch-later --limit 50
opencli youtube subscriptions --limit 30

# Search and video info
opencli youtube search "rust programming" --limit 5
opencli youtube video "https://www.youtube.com/watch?v=xxx"
opencli youtube transcript "https://www.youtube.com/watch?v=xxx"

# Write commands (requires login)
opencli youtube like "https://www.youtube.com/watch?v=xxx"
opencli youtube unlike "videoId"
opencli youtube subscribe "@ChannelHandle"
opencli youtube unsubscribe "UCxxxxxxxxxxxxxx"
opencli youtube comment "https://www.youtube.com/watch?v=xxx" "Great video!" --execute
```

> Note: `youtube comment` refuses to post unless `--execute` is passed, and never retries the write.
> **A 2xx from YouTube does not mean the comment is live** — it can answer 200 with a perfectly
> usable comment id for a comment it silently withholds (observed 2026-09-13: a video that still
> read "0 comments" afterwards). So the id the write returns is informational only; what sets
> `verified` is reading the video's comment list back and finding that id there. When the comment
> cannot be seen in the list — or no id came back at all — the row is `status: posted-unverified`
> with `verified: false` and a `COMMENT_UNVERIFIED` line on stderr, and `url` stays the plain video
> URL rather than an `&lc=` permalink that would point at a comment nobody can see. Treat that as
> "sent, go check the video", not as a failure to retry. Only a verified row gets the permalink
> (`watch?v=<id>&lc=<comment_id>`).
>
> A comment that is live but absent from the list we read would also be reported as unverified. That
> asymmetry is deliberate: an unverified success costs you one look at the video, while a false
> success makes you believe a comment landed when it did not.

## Prerequisites

- Chrome running and **logged into** youtube.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `feed` and `search` emit `channel_avatar` (largest thumbnail the list page carries) and `video_id`; both are empty for result types that have no channel avatar or video, such as playlist lockups
- `video` falls back to the channel's own browse response for `channelAvatar` / `subscribers` when the watch page ships no `videoOwnerRenderer` — one extra InnerTube call, only on the pages that need it

`channel` accepts a channel ID (`UC…`) or a handle with or without `@` (for example, `opencli youtube channel halfbraindev`). Handles are resolved before channel data is requested; unresolved handles return an error.
