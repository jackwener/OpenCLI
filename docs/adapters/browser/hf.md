# Hugging Face

**Mode**: 🌐 Public · **Domain**: `huggingface.co`

## Commands

| Command | Description |
|---------|-------------|
| `opencli hf top` | Top upvoted Hugging Face papers |
| `opencli hf paper <arxivId>` | Single paper detail (title / authors / summary / AI keywords / upvotes) |
| `opencli hf models` | Top Hugging Face models (downloads / likes / trending / freshness) |
| `opencli hf datasets` | Top Hugging Face datasets |
| `opencli hf spaces` | Top Hugging Face Spaces (gradio / streamlit / docker / static demos) |

## Usage Examples

```bash
# Today's top papers
opencli hf top --limit 10

# Single paper detail by arXiv id (mirrors HF's paper page)
opencli hf paper 1706.03762         # Attention Is All You Need
opencli hf paper 2005.14165         # GPT-3 paper

# All papers (no limit)
opencli hf top --all

# Specific date
opencli hf top --date 2025-03-01

# Weekly/monthly top papers
opencli hf top --period weekly
opencli hf top --period monthly

# Top models by downloads (default)
opencli hf models --limit 20

# Top text-generation models with name filter
opencli hf models --pipeline text-generation --search llama --sort likes --limit 10

# Top datasets by likes
opencli hf datasets --sort likes --limit 10

# Top Spaces by likes
opencli hf spaces --limit 20

# Filter Spaces by SDK
opencli hf spaces --sdk gradio --search llm --limit 10

# JSON output
opencli hf top -f json
```

### `top` Options

| Option | Description |
|--------|-------------|
| `--limit` | Number of papers (default: 20) |
| `--all` | Return all papers, ignoring limit |
| `--date` | Date in `YYYY-MM-DD` format (defaults to most recent) |
| `--period` | Time period: `daily`, `weekly`, or `monthly` (default: daily) |

Returns paper listing rows with `rank, id, title, upvotes, authors`. The `id` value round-trips into `opencli hf paper <id>`.

### `paper` Options

| Option | Description |
|--------|-------------|
| `id` (positional) | arXiv id (e.g. `1706.03762`, optionally with version suffix `v3`) |

Returns one row with `id, title, authors, publishedAt, upvotes, aiKeywords, summary, aiSummary, url`. The `summary` is the original arXiv abstract; `aiSummary` and `aiKeywords` are HF's AI-generated metadata (may be empty for older or non-curated papers). Returns `EmptyResultError` if HF has no paper page for that id.

### `models` Options

| Option | Description |
|--------|-------------|
| `--sort` | `downloads` / `likes` / `trending` / `created_at` / `last_modified` (default: `downloads`) |
| `--search` | Optional name/owner substring filter (e.g. `llama`, `mistralai/`) |
| `--pipeline` | Pipeline tag filter (e.g. `text-generation`, `image-classification`) |
| `--limit` | Max models (1–100, default: 20) |

### `datasets` Options

| Option | Description |
|--------|-------------|
| `--sort` | Same set as `models` (default: `downloads`) |
| `--search` | Optional name/owner substring filter |
| `--limit` | Max datasets (1–100, default: 20) |

### `spaces` Options

| Option | Description |
|--------|-------------|
| `--sort` | `likes` / `created_at` / `last_modified` (default: `likes`; HF doesn't accept `trending` for spaces) |
| `--search` | Optional name/owner substring filter (e.g. `stability`, `openai/`) |
| `--sdk` | SDK filter: `gradio` / `streamlit` / `docker` / `static` |
| `--limit` | Max spaces (1–100, default: 20) |

Returns rows with `rank, id, author, sdk, likes, tags, lastModified, url`.

## Prerequisites

- No browser required — uses public Hugging Face API
