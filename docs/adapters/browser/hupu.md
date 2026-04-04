# Hupu (虎扑)

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `bbs.hupu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli hupu hot` | Read Hupu hot threads |
| `opencli hupu search <keyword>` | Search Hupu threads by keyword |
| `opencli hupu detail <tid>` | Read one thread and optional hot replies |
| `opencli hupu reply <tid> <text>` | Reply to a thread or quote one reply |
| `opencli hupu like <tid> <pid>` | Like one reply |
| `opencli hupu unlike <tid> <pid>` | Cancel like on one reply |

## Usage Examples

```bash
# Hot threads
opencli hupu hot --limit 5

# Search threads
opencli hupu search 湖人 --limit 10

# Read one thread and include hot replies
opencli hupu detail 638234927 --replies true

# Reply to the thread
opencli hupu reply 638234927 "hello from opencli" --topic_id 502

# Quote one hot reply by pid
opencli hupu reply 638234927 "replying to this comment" --topic_id 502 --quote_id 174908

# Like / unlike one reply
opencli hupu like 638234927 174908 --fid 4860
opencli hupu unlike 638234927 174908 --fid 4860

# JSON output
opencli hupu detail 638234927 -f json
```

## Notes

- `reply --topic_id` maps to Hupu's API `topicId`, for example `502` for Basketball News
- `reply --quote_id` is the quoted reply `pid`
- `like` / `unlike --fid` uses the forum ID from thread metadata
- `detail --replies true` appends top hot replies to the content field

## Prerequisites

- Chrome running and able to open `bbs.hupu.com`
- [Browser Bridge extension](/guide/browser-bridge) installed
- For `reply`, `like`, and `unlike`, a valid Hupu login session in Chrome is required
