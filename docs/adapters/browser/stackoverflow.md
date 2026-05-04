# Stack Overflow

**Mode**: 🌐 Public · **Domain**: `stackoverflow.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli stackoverflow hot` | Hot questions |
| `opencli stackoverflow search <query>` | Search questions |
| `opencli stackoverflow bounties` | Questions with active bounties |
| `opencli stackoverflow unanswered` | Unanswered questions |
| `opencli stackoverflow read <id>` | Read a question with answers and comments |

## Listing columns

`hot`, `search`, and `bounties` share an agent-native shape so the
`question_id` is round-trippable into `stackoverflow read`:

| Column | Source | Notes |
|--------|--------|-------|
| `rank` | local | 1-indexed position |
| `id` | `question_id` | Feed into `stackoverflow read` |
| `title` | `title` | |
| `score` | `score` | |
| `answers` | `answer_count` | |
| `views` | `view_count` | |
| `is_answered` | `is_answered` | (omitted on `unanswered` since always false) |
| `tags` | `tags` (joined) | Comma-separated |
| `author` | `owner.display_name` | |
| `creation_date` | `creation_date` | Unix epoch seconds |
| `url` | `link` | Canonical question URL |
| `bounty` | `bounty_amount` | (`bounties` only, prepended after `id`) |

## `read` columns

`stackoverflow read <id>` fetches the question, answers up to
`--answers-limit` (accepted first, then by votes — if the accepted
answer is outside the votes-sorted page it is fetched separately and
prepended), question comments up to `--comments-limit`, and answer
comments up to `--comments-limit` per answer. It mirrors the
`hackernews read` and `lobsters read` thread shape.

| Column | Description |
|--------|-------------|
| `type` | `POST` / `Q-COMMENT` / `ANSWER` / `A-COMMENT` |
| `author` | Display name (HTML entities decoded) |
| `score` | Vote count for that row |
| `accepted` | `'true'` for the accepted answer, empty string otherwise |
| `text` | Body / comment, HTML stripped, entities decoded, indented for comments |

The accepted answer (if any) is always the first `ANSWER` row. Other
answers follow in descending score order. Comments under an answer appear
immediately after that answer with `A-COMMENT` type and a `> ` indent.

## Usage Examples

```bash
# Hot questions
opencli stackoverflow hot --limit 10

# Search questions
opencli stackoverflow search "async await" --limit 20

# Active bounties
opencli stackoverflow bounties --limit 10

# Unanswered questions
opencli stackoverflow unanswered --limit 10

# Read a question with answers and comments
opencli stackoverflow read 11227809
opencli stackoverflow read 11227809 --answers-limit 3 --comments-limit 5

# JSON output
opencli stackoverflow hot -f json
opencli stackoverflow read 11227809 -f json
```

## Caveats

- Stack Exchange API has a 300/day quota per IP for unauthenticated
  requests. A `read` call uses up to 4 quota units (question, question
  comments, answers, batched answer comments), or 5 when the accepted answer
  must be fetched separately.
- `--answers-limit` and `--comments-limit` are bounded to 1-100, matching the
  Stack Exchange API page size limit. If batched answer comments would be
  partial, the command fails fast instead of returning an incomplete thread.
- Bodies are returned as HTML; this adapter strips tags and decodes named
  / decimal / hex HTML entities for plain-text consumption.

## Prerequisites

- No browser required — uses the public Stack Exchange API
