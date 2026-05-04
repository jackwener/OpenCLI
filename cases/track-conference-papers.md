# Track a conference's accepted papers and reviews from the terminal

Once an OpenReview venue opens its decisions (or releases reviews publicly during the discussion phase), I want a one-shot way to pull the full venue listing and dive into individual review threads, without clicking through 200+ submission pages.

## What I wanted

For each major venue I follow (ICLR, NeurIPS, ICML), the same three things every time decisions are visible:

1. The full list of accepted papers at the venue, with titles and forum ids.
2. For any paper I flagged interesting from the list: the full review thread, including reviewer scores, rebuttals, and the AC's decision rationale.
3. A way to pipe both into LLM-driven shortlisting ("which of these 100 oral papers actually intersect with my research direction").

The OpenReview UI is fine for one paper at a time, but unusable for batch reasoning across the whole acceptance list.

## Commands

Worked example: ICLR 2024 oral track, then drill into one paper's reviews using a real forum id.

```bash
# 1. Full list of papers at a venue (natural-language venue text;
#    if the venue is not yet open OpenReview returns EMPTY_RESULT
#    with a help line listing valid forms)
opencli openreview venue "ICLR 2024 oral" --limit 200 -f json > /tmp/iclr-2024.json

# 2. Pick a forum id from the listing, fetch the full review thread.
#    Example: "Proving Test Set Contamination in Black-Box Language Models"
opencli openreview reviews KS8mIvetg2 -f json > /tmp/reviews.json

# 3. Single paper metadata if needed
opencli openreview paper KS8mIvetg2 -f json
```

`venue` returns each entry with a forum id you can hand straight back into `reviews` and `paper`. No id lookup gymnastics. `reviews` returns the full thread as a JSON array: a `PAPER` row with the abstract, then one `REVIEW` row per reviewer (with `rating`, `confidence`, summary, weaknesses, questions), followed by author rebuttals and the AC's decision rationale.

## What I do with the output

Two distinct workflows depending on the phase of the venue:

### Phase A: filtering the acceptance list

After `venue` returns 200 entries, dump the JSON into an LLM with the prompt:

```
Here is the full acceptance list at <venue>. Filter to papers that intersect
with my research interests:
  - reinforcement learning from preference / reward feedback
  - reasoning training (process reward, RLVR, RLHF variants)
  - long-horizon agent benchmarks
For each match: title + forum_id + one-sentence why-it-matters.
```

This collapses 200 papers to a 10-paper shortlist in seconds. The forum ids are the keys I will use in Phase B.

### Phase B: depth-reading the shortlist

For each shortlisted forum id, run `opencli openreview reviews <forum-id>` and feed the JSON to an LLM with the prompt:

```
Summarize the review thread:
  - reviewer scores
  - the strongest critique
  - whether the rebuttal addressed it
  - final decision and AC rationale
```

This is faster than reading three reviews + rebuttal + meta-review per paper. For 10 papers this turns 60 minutes of OpenReview clicking into 10 minutes of summary reading, then I open the actual reviews only for papers where the summary flagged something worth knowing.

## Why this beats opening OpenReview

- One `venue` call replaces scrolling a paginated UI for 200+ papers.
- `reviews` returns the entire thread as JSON, so an LLM can reason over the whole review-rebuttal-decision arc at once. The web view forces you to scroll three reviews + N rebuttals + meta separately.
- Forum ids returned from `venue` are stable and reusable across calls. Easy to keep a personal reading list as `forum-ids.txt` and run `for id in $(cat forum-ids.txt); do opencli openreview reviews $id; done`.
- The whole loop is public-strategy. No login required for venues with public reviewing.

`opencli openreview` (added in #1294) is the lever. Before this adapter existed, the same workflow needed either OpenReview's Python client or HTML scraping inside agent code. Both have higher friction than `opencli openreview reviews <forum-id>` returning structured JSON in one shot.
