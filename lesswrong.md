# LessWrong

**Mode**: Public · **Domain**: `www.lesswrong.com`

Rationality community and AI alignment research forum.

## Commands

| Command | Description |
|---------|-------------|
| `opencli lesswrong curated` | Editor's picks |
| `opencli lesswrong frontpage` | Algorithmic frontpage feed |
| `opencli lesswrong new` | Latest posts |
| `opencli lesswrong top` | Top rated (all time) |
| `opencli lesswrong top-week` | Top rated this week |
| `opencli lesswrong top-month` | Top rated this month |
| `opencli lesswrong top-year` | Top rated this year |
| `opencli lesswrong read` | Read full post by URL or ID |
| `opencli lesswrong comments` | Top comments on a post |
| `opencli lesswrong user` | User profile |
| `opencli lesswrong user-posts` | List a user's posts |
| `opencli lesswrong tag` | Posts by tag |
| `opencli lesswrong tags` | List popular tags |
| `opencli lesswrong sequences` | Post collections |
| `opencli lesswrong shortform` | Quick takes |

## Usage Examples

```bash
# Browse curated posts
opencli lesswrong curated --limit 5

# Top posts this week
opencli lesswrong top-week --limit 10

# Read a specific post
opencli lesswrong read CzoiqGzpShprcv2Jd
opencli lesswrong read https://www.lesswrong.com/posts/xxx/slug

# Posts tagged "AI"
opencli lesswrong tag ai --limit 5

# User profile and posts
opencli lesswrong user zvi
opencli lesswrong user-posts zvi --limit 5

# Comments on a post
opencli lesswrong comments CzoiqGzpShprcv2Jd --limit 10

# JSON output
opencli lesswrong curated -f json
```

## Prerequisites

- No browser required — uses public LessWrong GraphQL API
