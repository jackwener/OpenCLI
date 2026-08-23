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
| `opencli nowcoder comments <id>` | Mine comments, authors, and reply relationships |

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

# Read up to 20 top-level comments
opencli nowcoder comments 3e22dc2df03d4227ab70ea9c2d896086 --limit 20

# Build a structured comment tree, including up to 20 replies per root comment
opencli nowcoder comments 3e22dc2df03d4227ab70ea9c2d896086 --with-replies --replies-limit 20 -f json

# Keep high-engagement comments and sort by likes
opencli nowcoder comments 3e22dc2df03d4227ab70ea9c2d896086 --with-replies --min-likes 5 --min-replies 1 --sort likes

# Keep comments with fetched direct replies and sort by that structural count
opencli nowcoder comments 3e22dc2df03d4227ab70ea9c2d896086 --with-replies --min-direct-replies 1 --sort direct-replies

# Track comments by a stable author ID
opencli nowcoder comments 3e22dc2df03d4227ab70ea9c2d896086 --with-replies --author-id 943123728 -f json

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

## Comment Mining Semantics

`replies` always contains Nowcoder's server-reported total. When `--with-replies` is used, `direct_replies` contains the number of direct child edges in the fetched result; otherwise it is `null`.

A truncated reply whose ancestor is absent keeps its `parent_id`, returns `depth: null`, and sets `ancestry_complete: false`. Known edges inside an incomplete component are still ordered parent-first.

## Prerequisites

- **Public commands** (hot, trending, topics, recommend, creators, companies, jobs, comments): No login required
- **Cookie commands** (all others): Chrome running and **logged into** nowcoder.com, [Browser Bridge extension](/guide/browser-bridge) installed
