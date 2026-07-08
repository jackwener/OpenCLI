# OpenReview

**Mode**: 🌐 Public · **Domain**: `openreview.net`

OpenReview is the open peer-review platform used by ICLR, COLM, NeurIPS workshops, TMLR, and many other ML venues. The v2 API exposes everyone-readable submissions, reviews, and decisions without authentication, so all five commands run without a browser.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openreview search <query>` | Full-text search across all OpenReview papers |
| `opencli openreview venue <venue>` | List papers at a venue (e.g. `"ICLR 2024 oral"` or full invitation id) |
| `opencli openreview author <profile>` | List submissions by an author profile id (e.g. `"~Yoshua_Bengio1"`), newest first |
| `opencli openreview paper <id>` | Show full metadata (incl. abstract) for a single paper |
| `opencli openreview reviews <forum>` | Show paper + threaded reviews/decisions/comments |

## Usage Examples

```bash
# Full-text search
opencli openreview search "diffusion model" --limit 10

# Browse a venue by display name (matched against content.venue)
opencli openreview venue "ICLR 2024 oral" --limit 20

# Browse a venue by full invitation id (use this when display names overlap)
opencli openreview venue "ICLR.cc/2025/Conference/-/Submission" --limit 50 --offset 0

# Every submission by an author profile id (find it on the author's openreview.net profile URL)
opencli openreview author "~Yoshua_Bengio1" --limit 20

# Single-paper detail (full abstract)
opencli openreview paper KS8mIvetg2

# Full review thread — paper + reviews + decision + author rebuttal
opencli openreview reviews KS8mIvetg2 --max-length 4000

# JSON output
opencli openreview search "LLM" -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, title, authors, venue, pdate, url` |
| `venue` | `rank, id, title, authors, keywords, primary_area, pdate, pdf, url` |
| `author` | `rank, id, title, authors, venue, pdate, url` |
| `paper` | `id, title, authors, keywords, venue, venueid, primary_area, abstract, pdate, pdf, url` |
| `reviews` | `type, author, rating, confidence, text` |

The `id` returned by `search`/`venue`/`author` round-trips into `paper`/`reviews` — it is the OpenReview note id (also the `forum` id for top-level submissions). `pdf` is normalized to an absolute `https://openreview.net/pdf/...` URL.

## `reviews` Output

`reviews` walks the forum's reply tree once and emits one row per note in chronological order, with the original submission lifted to the top:

| `type` | When emitted |
|--------|--------------|
| `PAPER` | The submission itself (always row 0) |
| `REVIEW` | An `Official_Review` reply |
| `META_REVIEW` | A meta-review by Area Chairs |
| `DECISION` | The final decision note |
| `REBUTTAL` | An author rebuttal note |
| `COMMENT` | An `Official_Comment` reply |
| `WITHDRAWAL` | A withdrawal confirmation |

`rating` and `confidence` are the raw OpenReview enum strings (e.g. `"6: marginally above the acceptance threshold"`). `text` joins together the standard sections — Summary, Strengths, Weaknesses, Questions, Comment, Rebuttal, Decision, Recommendation — and is per-row truncated to `--max-length` (default 4000, min 200).

## Caveats

- OpenReview indexes a lot of DBLP-mirrored entries (CoRR / journal records). Search results may include those alongside actual OpenReview submissions; only OpenReview-hosted papers have full review threads available via `reviews`.
- The default sort for `search` is the API's relevance-by-term ranking. For a chronological view, use `venue` against the relevant invitation.
- `pdate` (publication date) falls back to `cdate` (creation date) when missing, formatted as `YYYY-MM-DD`.
- `venue` accepts either a display name (`"ICLR 2024 oral"`, matched against `content.venue`) or a full invitation id (`"ICLR.cc/2025/Conference/-/Submission"`). The presence of the literal `/-/` segment is what disambiguates the two modes.

## Prerequisites

- No browser required — uses the public OpenReview v2 API at `https://api2.openreview.net`.
