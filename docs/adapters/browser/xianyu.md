# Xianyu (闲鱼)

**Mode**: 🔐 Browser · **Domain**: `goofish.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xianyu search <query>` | Search Xianyu items by keyword and return item cards with `item_id` |
| `opencli xianyu item <item_id>` | Fetch item details including title, price, condition, brand, seller, and image URLs |
| `opencli xianyu inbox` | List recent Xianyu private-message conversations, including `unread` and `unread_count` |
| `opencli xianyu messages <item_id> <user_id>` | Read recent visible messages from a specific Xianyu conversation |
| `opencli xianyu chat <item_id> <user_id>` | Open a Xianyu chat session for the item/user pair and optionally send a message with `--text` |
| `opencli xianyu reply <item_id> <user_id> --text <message>` | Reply to a specific Xianyu private-message conversation |
| `opencli xianyu publish <title> <description> <price> <condition> <category>` | Publish a Xianyu listing from the authenticated browser session |

## Usage Examples

```bash
# Search items
opencli xianyu search "macbook" --limit 5

# Read a single item's details
opencli xianyu item 1040754408976

# List recent private-message conversations
opencli xianyu inbox --limit 20 -f json
opencli xianyu inbox --unread-only true -f json

# Read messages from a specific conversation
opencli xianyu messages 1038951278192 3650092411 --limit 50 -f json
opencli xianyu messages --rank 1 --limit 50 -f json

# Open a chat session
opencli xianyu chat 1038951278192 3650092411

# Send a message in chat
opencli xianyu chat 1038951278192 3650092411 --text "你好，这个还在吗？"

# Reply to a specific conversation
opencli xianyu reply 1038951278192 3650092411 --text "你好，这个还在吗？"
opencli xianyu reply --rank 1 --text "你好，这个还在吗？"

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
- `inbox` returns `unread` and `unread_count`; use `--unread-only true` to list only unread conversations
- `inbox --resolve-ids true` attempts to click visible rows and resolve `item_id` / `peer_user_id`, but Xianyu may keep some conversations in SPA state without exposing IDs in the URL
- `messages --rank <n>` and `reply --rank <n>` operate on the visible row number returned by `inbox`, which is more reliable for Xianyu's current IM UI
- `chat` and `reply` require both the item ID and the target user's `user_id` / `peerUserId`
- `messages` reads currently visible/recent messages in the conversation view; older messages may require the site to load more history
- `publish` executes immediately after filling the listing form; supported conditions are `全新`, `几乎全新`, `轻微使用`, `明显使用`, and `老旧`
- Browser-authenticated commands depend on the active Chrome login session remaining valid
