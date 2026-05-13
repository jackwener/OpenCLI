# Rednote (国际版小红书)

**Mode**: 🔐 Browser · **Domain**: `www.rednote.com` (cookie root `.rednote.com`)

Rednote is the international mirror of Xiaohongshu. Logged-in users outside mainland China are redirected from `www.xiaohongshu.com` to `www.rednote.com`, where the codebase is largely the same but hostnames and cookie root differ. This adapter exists so those users have working CLI commands without juggling the mainland-domain `xiaohongshu` adapter. See issue #1136 for the host-by-host comparison.

## Commands

| Command | Description |
|---------|-------------|
| `opencli rednote search` | Search notes by keyword (returns title, author, likes, URL, author URL) |
| `opencli rednote note` | Read full note content (title, author, description, likes, collects, comments, tags) |
| `opencli rednote comments` | Read comments from a note (`--with-replies` for nested 楼中楼 replies) |
| `opencli rednote user` | Get public notes from a user profile |
| `opencli rednote feed` | Home feed (reads the hydrated Pinia store) |
| `opencli rednote notifications` | Notifications (`--type mentions|likes|connections`) |
| `opencli rednote download` | Download images and videos from a note |

## Usage Examples

```bash
# Search for notes
opencli rednote search travel --limit 10

# Read a note's full content (pass URL from search results to preserve xsec_token)
opencli rednote note "https://www.rednote.com/search_result/<id>?xsec_token=..."

# Read comments with nested replies (楼中楼)
opencli rednote comments "https://www.rednote.com/search_result/<id>?xsec_token=..." --with-replies --limit 20

# JSON output
opencli rednote search travel -f json

# User profile notes
opencli rednote user 5b21f6564eacab3b38f05c39 --limit 10

# Download
opencli rednote download "https://www.rednote.com/search_result/<id>?xsec_token=..."
```

> Note: `note`, `comments`, and `download` require a full signed rednote.com note URL with `xsec_token`. Bare note IDs and xhslink.com short links are not accepted because they cannot prove the rednote host/cookie identity before navigation.

## Prerequisites

- Chrome running and **logged into** rednote.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Implementation

The rednote command files are thin shims that import the DOM-extraction IIFEs and URL helpers from their `clis/xiaohongshu/*` counterparts and call `cli()` with the rednote host triple. There is no duplicate copy of selectors, regexes, or extraction logic.

| Layer | xiaohongshu | rednote |
|---|---|---|
| Web host | `www.xiaohongshu.com` | `www.rednote.com` |
| API host | `edith.xiaohongshu.com` | `webapi.rednote.com` |
| Security/signing host | `fe-static.xhscdn.com` | `as.rednote.com` |
| Cookie root | `.xiaohongshu.com` | `.rednote.com` |
| Search login gate | Inline `登录后查看搜索结果` text | Full-screen login modal (plus the inline text as a fallback) |

`rednote feed` and `rednote notifications` cannot share the xiaohongshu intercept pipeline. rednote's `feed.feeds` is populated from SSR and the field names are camelCase (`noteCard.displayTitle`, `interactInfo.likedCount`) rather than xhs's snake_case API shape, so the xhs tap captures nothing. `notification.notificationMap[<type>].messageList` is filled by the in-page `getNotification()` action without firing a network request the tap can match. Both rednote commands therefore read the hydrated Pinia store in `func` mode, accepting both casing conventions when extracting fields. Creator-center commands (`publish`, `creator-*`) have no rednote counterpart and stay xiaohongshu-only.
