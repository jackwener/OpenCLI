# Daily RL research monitor

A 30-second morning routine that surfaces what changed overnight in reinforcement-learning and large-model research, without opening a browser.

## What I wanted

Before reading anything, decide where to spend my 20 minutes of paper time:

- which `cs.LG` and `cs.AI` papers landed in the last 24 hours
- which OpenReview submissions at recent venues (NeurIPS 2025 right now, ICLR 2024 / NeurIPS 2024 as historical reference) carry titles and primary areas relevant to my work
- which papers the Hugging Face Daily Papers community is talking about today

Skim signals, then drill in. The point is to filter, not to read everything.

## Commands

```bash
# 1. arxiv recent in the two relevant categories (newest 30 each)
opencli arxiv recent cs.LG --limit 30 -f json > /tmp/lg.json
opencli arxiv recent cs.AI --limit 30 -f json > /tmp/ai.json

# 2. NeurIPS 2025 oral track from OpenReview (use natural-language
#    venue text; the EMPTY_RESULT error helpfully echoes valid syntax
#    if a venue is not yet open)
opencli openreview venue "NeurIPS 2025 oral" --limit 50 -f json > /tmp/neurips.json

# 3. Hugging Face Daily Papers (community-upvoted research)
opencli hf top --period daily --limit 20 -f json > /tmp/hf.json
```

That is the entire collection step. The four files together are the whole signal surface for one morning.

## What I do with the output

Pipe the four JSON files into a one-shot LLM digest with a fixed prompt:

```
Here are four JSON arrays of papers from the last 24 hours.
Group them into:
  1. Direct hits on RLHF / preference optimization / reasoning RL.
  2. Adjacent (offline RL, world models, agent benchmarks).
  3. Notable infra (training, evaluation, data).
For each, give me title + arxiv id + one-sentence why-it-matters.
Skip everything that is review / survey / position paper.
```

The LLM compresses ~120 entries into a 10-line shortlist in seconds. I then open whichever 2 to 3 papers actually clear the bar.

## Why CLI beats the browser version

- Four pages of clicking and scrolling collapses into four `opencli` calls.
- The output is structured JSON, so the digest prompt can reason about it deterministically. No copy-paste, no "I missed paper 14".
- Works inside any agent loop. A scheduled task can run the four commands, push them to an LLM, and message the digest somewhere. No browser kept open.
- Zero token cost on the OpenCLI side. The only paid step is the digest call at the end.

The arxiv adapter's `recent <category>` (added in #1289) is the lever here. Without it I would have to fall back to the arxiv listings page, which means scraping HTML in agent code instead of consuming a structured listing.
