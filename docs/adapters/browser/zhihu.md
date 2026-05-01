# Zhihu

**Mode**: 🔐 Browser · **Domain**: `zhihu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli zhihu hot` | Read Zhihu hot topics |
| `opencli zhihu search` | Search Zhihu content |
| `opencli zhihu question` | Read question answers by question ID |
| `opencli zhihu collections` | List your Zhihu favorite collections |
| `opencli zhihu collection <collection_id>` | List content from a Zhihu favorite collection |
| `opencli zhihu download` | Export a Zhihu article to Markdown |
| `opencli zhihu follow <target> --execute` | Follow a user or question |
| `opencli zhihu like <target> --execute` | Like an answer or article |
| `opencli zhihu favorite <target> (--collection <name> \| --collection-id <id>) --execute` | Favorite an answer or article into a specific collection |
| `opencli zhihu comment <target> (<text> \| --file <path>) --execute` | Create a top-level comment when a fresh top-level editor is already present |
| `opencli zhihu answer <target> (<text> \| --file <path>) --execute` | Create a new answer when a fresh answer editor is already present |

## Target Formats

- Question: `question:123456` or `https://www.zhihu.com/question/123456`
- Answer: `answer:123456:789012` or `https://www.zhihu.com/question/123456/answer/789012`
- Article: `article:998877` or `https://zhuanlan.zhihu.com/p/998877`
- User: `user:alice` or `https://www.zhihu.com/people/alice`

## Write Safety Notes

- All write commands require `--execute`
- `favorite` requires exactly one of `--collection` or `--collection-id`
- `favorite` only supports existing collections, it does not create new collections
- `comment` only supports top-level comments
- `comment` currently requires the page to already expose a fresh top-level comment editor
- `answer` only supports creating a new non-anonymous plain-text answer
- `answer` currently requires the page to already expose a fresh answer editor
- `comment` and `answer` also support `--file <path>` for multi-line payloads
- Article targets can live on `zhuanlan.zhihu.com`, while question and answer targets stay on `www.zhihu.com`

## Usage Examples

```bash
# Read flows
opencli zhihu hot --limit 5
opencli zhihu question 123456 --limit 3
opencli zhihu collections --limit 20
opencli zhihu collection 83283292 --limit 20
opencli zhihu download "https://zhuanlan.zhihu.com/p/998877" --download-images

# Write flows
opencli zhihu follow question:123456 --execute
opencli zhihu follow user:alice --execute
opencli zhihu like answer:123456:789012 --execute
opencli zhihu like article:998877 --execute
opencli zhihu favorite article:998877 --collection "默认收藏夹" --execute
opencli zhihu favorite answer:123456:789012 --collection-id fav-b --execute
opencli zhihu comment answer:123456:789012 --file ./comment.txt --execute
opencli zhihu answer question:123456 --file ./answer.txt --execute

# JSON output
opencli zhihu hot -f json
```

## Prerequisites

- Chrome running and **logged into** zhihu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
- A logged-in Zhihu session that can access both `www.zhihu.com` and `zhuanlan.zhihu.com`
