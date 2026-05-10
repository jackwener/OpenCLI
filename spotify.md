# Spotify

**Mode**: 🔑 OAuth API · **Domains**: `accounts.spotify.com`, `api.spotify.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli spotify auth` | Authenticate with Spotify and store tokens locally |
| `opencli spotify status` | Show current playback status |
| `opencli spotify play [query]` | Resume playback or search-and-play a track |
| `opencli spotify pause` | Pause playback |
| `opencli spotify next` | Skip to the next track |
| `opencli spotify prev` | Skip to the previous track |
| `opencli spotify volume <0-100>` | Set playback volume |
| `opencli spotify search <query>` | Search Spotify tracks |
| `opencli spotify queue <query>` | Add a track to the playback queue |
| `opencli spotify shuffle <on|off>` | Toggle shuffle |
| `opencli spotify repeat <off|track|context>` | Set repeat mode |

## Usage Examples

```bash
# First-time setup
opencli spotify auth

# What is playing right now?
opencli spotify status

# Resume playback
opencli spotify play

# Search and immediately play a track
opencli spotify play "Numb Linkin Park"

# Search without playing
opencli spotify search "Daft Punk" --limit 5 -f json

# Queue a track
opencli spotify queue "Get Lucky"

# Playback controls
opencli spotify pause
opencli spotify next
opencli spotify prev
opencli spotify volume 35
opencli spotify shuffle on
opencli spotify repeat track
```

## Setup

1. Create a Spotify app at <https://developer.spotify.com/dashboard>
2. Add `http://127.0.0.1:8888/callback` to the app's Redirect URIs
3. Fill in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `~/.opencli/spotify.env`
4. Run `opencli spotify auth`

## Notes

- Browser Bridge is not required.
- Tokens are stored locally at `~/.opencli/spotify-tokens.json`.
- Playback commands work best when you already have an active Spotify device/session.
