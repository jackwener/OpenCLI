# Xianyu (闲鱼)

**Mode**: 🔐 Browser · **Domain**: `goofish.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xianyu search <query>` | Search Xianyu items by keyword and return item cards with `item_id` |
| `opencli xianyu item <item_id>` | Fetch item details including title, price, condition, brand, seller, and image URLs |
| `opencli xianyu chat <item_id> <user_id>` | Open a Xianyu chat session for the item/user pair and optionally send a message with `--text` |
| `opencli xianyu publish <title> <description> <price> <condition> <category>` | Publish a Xianyu listing from the authenticated browser session |

## Usage Examples

```bash
# Search items
opencli xianyu search "macbook" --limit 5

# Read a single item's details
opencli xianyu item 1040754408976

# Open a chat session
opencli xianyu chat 1038951278192 3650092411

# Send a message in chat
opencli xianyu chat 1038951278192 3650092411 --text "你好，这个还在吗？"

# Publish a listing immediately
opencli xianyu publish "MacBook Pro" "成色很好，功能正常" 5999 "轻微使用" "笔记本" --images /tmp/a.jpg,/tmp/b.jpg

# JSON output
opencli xianyu search "笔记本电脑" -f json
opencli xianyu item 1040754408976 -f json
```

## Prerequisites

- Chrome running and **logged into** `goofish.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `search` returns `item_id`, which can be passed directly into `opencli xianyu item`
- `chat` requires both the item ID and the target user's `user_id` / `peerUserId`
- `publish` executes immediately after filling the listing form; supported conditions are `全新`, `几乎全新`, `轻微使用`, `明显使用`, and `老旧`
- Browser-authenticated commands depend on the active Chrome login session remaining valid
