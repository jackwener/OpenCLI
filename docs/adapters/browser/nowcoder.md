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
| `opencli nowcoder search <query>` | Search posts, moments, and `--type all` job cards |
| `opencli nowcoder suggest <query>` | Search suggestions |
| `opencli nowcoder experience` | Interview experience posts |
| `opencli nowcoder referral` | Internal referral posts |
| `opencli nowcoder salary` | Salary disclosure posts |
| `opencli nowcoder papers` | Interview question bank by company & job |
| `opencli nowcoder practice` | Categorized practice questions with progress |
| `opencli nowcoder notifications` | Unread message summary |
| `opencli nowcoder detail <id>` | Content or moment detail (numeric ID, UUID, or canonical URL) |

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

# View a specific post detail (use the ID or URL returned by list commands)
opencli nowcoder detail 912885704667987968

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

## Post identity

Search responses have two representations: direct rows for `--type post`, and
`rc_type`-wrapped rows for `--type all`. The adapter normalizes both without
cross-converting unsupported result types.

- `post_type: content` covers content entity types 8 and 73 (regular posts and
  blog-style articles). It uses a numeric `id`, `/discuss/<id>`, the
  content-data detail endpoint, and `createTime`.
- `post_type: moment` uses its 32-character UUID as `id`,
  `/feed/main/detail/<uuid>`, the moment-data detail endpoint, and `createdAt`.
- `post_type: job` represents a job card from an `rc_type: 213` group. Job ID,
  title, company, and timestamp are preserved; content-only fields stay empty.
- Company results (`rc_type: 205`) are reported as skipped in verbose mode and
  are not converted into posts.

Anonymous moments use the presentation identity from `userBrief`, which can
legitimately differ from the underlying moment user ID. Missing author fields
produce empty author columns rather than dropping the post. `rc_type`,
`content_type`, `entity_type`, and `is_anonymous` preserve the source
discriminators used to select the parser.

Pass the returned `id` or `url` to `nowcoder detail`. A content UUID is metadata and is not a valid `/discuss/` identifier; a moment's numeric `entity_id` is not accepted by the moment detail endpoint.
