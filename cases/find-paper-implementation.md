# Find a paper's implementation and follow-up work

Given a single paper title or arxiv id, walk three sources in one chain to find the canonical reference, follow-up citations, and any community-fine-tuned models or Spaces that already build on it.

## What I wanted

I read a paper abstract, decide it is interesting, and want to answer three questions before deciding to actually re-read the paper or reproduce it:

1. Has anyone already implemented or fine-tuned on top of it (Hugging Face)?
2. Who has cited or extended it (dblp / OpenReview)?
3. What is the canonical bibliographic record (dblp key for citation, full arxiv metadata for reading)?

Doing this in a browser means three tabs and two minutes of context-switching. The point is to compress that into one shell pipeline.

## Commands

Worked example: "Direct Preference Optimization" (DPO).

```bash
# 1. Canonical arxiv record (full abstract, authors, pdf url, categories).
#    Note: arxiv free-text search ranks by recency, so the original DPO
#    paper does not always come back first. When the canonical id is
#    already known, hit `arxiv paper <id>` directly.
opencli arxiv search "Direct Preference Optimization" --limit 5 -f json
opencli arxiv paper 2305.18290 -f json

# 2. dblp bibliography record + co-authors + venue history
opencli dblp search "Direct Preference Optimization" --limit 5 -f json

# 3. Community uptake on Hugging Face: trending Daily Papers that mention DPO
opencli hf top --period monthly --limit 50 -f json | jq '.[] | select(.title | test("DPO|preference"; "i"))'

# 4. Conference review record (if posted to OpenReview)
opencli openreview search "Direct Preference Optimization" --limit 5 -f json
```

Three of the four are public-strategy adapters, no browser session needed. The OpenReview call also lands without auth for public venues.

## What I do with the output

For DPO the chain produces:

- arxiv record: paper id `2305.18290`, full abstract, pdf link.
- dblp record: canonical key `conf/nips/RafailovSMMEF23`, NeurIPS 2023, co-author list (useful to find related work by same lab).
- HF Daily Papers (last 30 days): every paper whose title mentions DPO or preference. Each one is a candidate "follow-up work I should know about".
- OpenReview: the original submission's review thread, if posted (lets me see what reviewers actually pushed back on, which is more useful than the published abstract).

I dump all four JSON outputs into a single LLM call with the prompt: *"Build a one-paragraph 'state of the field' summary for this paper as of today. Cite each follow-up by arxiv id."* That gives me a research-debt brief in 30 seconds.

## Why this is worth a CLI chain

- Each adapter alone is just "search a website". The value is the chain. Four `opencli` calls feed into one LLM call. No browser, no copy-paste.
- Output is identifier-rich (arxiv id, dblp key, venue id, HF paper id). I can re-feed any of those into the next call, e.g. once I find a follow-up arxiv id from HF Daily Papers I run `opencli arxiv paper <new-id>` immediately.
- Survives use inside an agent loop. Same chain runs unattended for a batch of 20 papers from a reading list.
- Zero token cost for the discovery half. Only the final summary step pays for inference.

Without `opencli dblp search` (added in #1299) and `opencli openreview search` (added in #1294), this whole pipeline used to require either web scraping in agent code or paying for a research-paper API. Both adapters being public-strategy means they slot in cleanly.
