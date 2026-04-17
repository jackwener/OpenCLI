# 牛客网 (Nowcoder)

**Mode**: 🌐 / 🔐 · **Domain**: `nowcoder.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli nowcoder hot` | Hot search ranking |
| `opencli nowcoder trending` | Trending posts |
| `opencli nowcoder topics` | Hot discussion topics |
| `opencli nowcoder recommend` | Recommended feed |
| `opencli nowcoder creators` | Top content creators leaderboard |
| `opencli nowcoder companies` | Hot companies for interview prep |
| `opencli nowcoder jobs` | Career category listing |
| `opencli nowcoder search <query>` | Full-text search (type: all/post/question/user/job) |
| `opencli nowcoder suggest <query>` | Search suggestions |
| `opencli nowcoder experience` | Interview experience posts |
| `opencli nowcoder referral` | Internal referral posts |
| `opencli nowcoder salary` | Salary disclosure posts |
| `opencli nowcoder papers` | Interview question bank by company & job |
| `opencli nowcoder practice` | Categorized practice questions with progress |
| `opencli nowcoder notifications` | Unread message summary |
| `opencli nowcoder detail <id>` | Post detail view (supports ID / UUID / URL) |

## Usage Examples

```bash
# Hot search ranking
opencli nowcoder hot --limit 10

# Search for interview experiences
opencli nowcoder search "bilibili" --type post --limit 5

# Search suggestions
opencli nowcoder suggest "java"

# Browse interview experience posts
opencli nowcoder experience --limit 10

# View a specific post detail (using UUID from list commands)
opencli nowcoder detail 2b6b64d4adb34ea3838e832ae4447ab1

# Interview question bank for Java at Huawei
opencli nowcoder papers --job 11002 --company 239

# Practice questions for software development
opencli nowcoder practice --job 11226 --limit 10

# Hot companies for C++ positions
opencli nowcoder companies --job 11003

# JSON output
opencli nowcoder trending -f json

# Verbose mode
opencli nowcoder hot -v
```

## Prerequisites

- **Public commands** (hot, trending, topics, recommend, creators, companies, jobs): No login required
- **Cookie commands** (all others): Chrome running and **logged into** nowcoder.com, [Browser Bridge extension](/guide/browser-bridge) installed
