# NeteaseMusic (网易云音乐)

Control **NeteaseMusic** (网易云音乐) from the terminal via Chrome DevTools Protocol (CDP). The app uses Chromium Embedded Framework (CEF).

## Prerequisites

Launch with remote debugging port:
```bash
/Applications/NeteaseMusic.app/Contents/MacOS/NeteaseMusic --remote-debugging-port=9234
```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9234"
```

## Commands

| Command | Description |
|---------|-------------|
| `opencli neteasemusic status` | Check CDP connection |
| `opencli neteasemusic playing` | Current song info (title, artist, album) |
| `opencli neteasemusic play` | Play / Pause toggle |
| `opencli neteasemusic next` | Skip to next song |
| `opencli neteasemusic prev` | Go to previous song |
| `opencli neteasemusic search "query"` | Search songs, artists |
| `opencli neteasemusic playlist` | Show current playback queue |
| `opencli neteasemusic like` | Like / unlike current song |
| `opencli neteasemusic lyrics` | Get lyrics of current song |
| `opencli neteasemusic volume [0-100]` | Get or set volume |
