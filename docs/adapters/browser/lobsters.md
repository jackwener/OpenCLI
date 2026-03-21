# Lobsters

**Mode**: 🌐 Public · **Domain**: `lobste.rs`

## Commands

| Command | Description |
|---------|-------------|
| `opencli lobsters hot` | Hottest stories |
| `opencli lobsters newest` | Latest stories |
| `opencli lobsters active` | Most active discussions |
| `opencli lobsters tag` | Stories by tag |

## Usage Examples

```bash
# Quick start
opencli lobsters hot --limit 10

# Filter by tag
opencli lobsters tag --tag rust --limit 5

# JSON output
opencli lobsters hot -f json

# Verbose mode
opencli lobsters hot -v
```

## Prerequisites

None — all commands use the public JSON API, no browser or login required.
