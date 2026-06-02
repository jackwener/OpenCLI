---
name: daily-brief
description: Generate a high-signal brief for any user-chosen topic or interest profile. Use when the user types /daily-brief, asks to "run a daily brief", "produce today's briefing", "scan this topic", "生成简报", "看看今天某个主题有什么进展", or wants a sourced briefing from RSS, web, community, and recent discussion signals.
---

# Daily Brief Protocol

You are running a daily briefing generator. The user supplies the topic, interest profile, or source list; if they do not, infer a broad but explicit profile from your understanding of your user.

**Objective:** Generate a concise, sourced, actionable brief for the reader's stated interests and save it as a local markdown artifact.

<!-- EDIT INTEREST PROFILE HERE -->
**Default interest profile：**
- Use the user's topic argument when present.
- If no topic argument is present, do your best effort to infer a concise interest profile based on your understanding of your user. Look for explicit topic mentions, keywords, and signals in the current request and recent briefs.
- If neither exists, ask for one concise topic/profile before researching.
<!-- /EDIT INTEREST PROFILE -->

---

## Stage 0 — Prereq check

```bash
DAILY_BRIEF_SKILL_DIR="${DAILY_BRIEF_SKILL_DIR:-}"
if [ -z "$DAILY_BRIEF_SKILL_DIR" ]; then
  for candidate in \
    ".claude/skills/daily-brief" \
    "$HOME/.claude/skills/daily-brief" \
    "$HOME/.codex/skills/daily-brief" \
    "skills/daily-brief" \
    "/app/skills/daily-brief" \
    "/usr/local/lib/python3.11/skills/daily-brief" \
    "/opt/venv/lib/python3.11/skills/daily-brief" \
    ".agents/skills/daily-brief"; do
    if [ -f "$candidate/SKILL.md" ]; then
      DAILY_BRIEF_SKILL_DIR="$candidate"
      break
    fi
  done
fi
[ -n "$DAILY_BRIEF_SKILL_DIR" ] || { echo "daily-brief skill directory not found" >&2; exit 1; }
export DAILY_BRIEF_SKILL_DIR

bash "$DAILY_BRIEF_SKILL_DIR/scripts/check_prereqs.sh"
```

This verifies the bundled `last30days` runtime, Python 3.12+, and local storage directories.

---

## 1) Hard Rules

1. All date windows are computed from **today** inside the command that uses them.
2. Prefer sources from the last 24-72 hours. Older material may appear only as labeled background.
3. Do not fill sections with generic background, stale news, or items unrelated to the selected topic.
4. Each substantive claim needs a source link and publication date when available.

---

## 2) Context Loading

Build a URL blacklist from the latest three local briefs:

```bash
BRIEF_HOME="${DAILY_BRIEF_HOME:-.daily-brief}"
mkdir -p "$BRIEF_HOME/briefings"
RECENT=$(ls -t "$BRIEF_HOME"/briefings/*.md 2>/dev/null | head -n3)
mkdir -p "$BRIEF_HOME/tmp"
[ -n "$RECENT" ] && grep -hoP 'https?://[^\s\)]+' $RECENT | sort -u > "$BRIEF_HOME/tmp/url-blacklist" || : > "$BRIEF_HOME/tmp/url-blacklist"
echo "blacklist size: $(wc -l < "$BRIEF_HOME/tmp/url-blacklist")"
```

Read `.daily-brief/tmp/url-blacklist` before citing sources. Skip URLs already used in recent briefs unless the user explicitly asks for an update on the same story.

Check whether today's brief exists:

```bash
BRIEF_HOME="${DAILY_BRIEF_HOME:-.daily-brief}"
TODAY_FILE="$BRIEF_HOME/briefings/$(date +%Y-%m-%d).md"
[ -s "$TODAY_FILE" ] && { echo "=== existing brief: $TODAY_FILE ==="; head -n10 "$TODAY_FILE"; } || echo "no brief yet"
```

If it exists, choose the least destructive branch from the user's request: reuse it, back it up before regenerating, or stop.

---

## 3) Phase 1: Research → Brief

### 3.0 RSS Radar

Run RSS discovery first. It is a source radar, not final prose:

```bash
BRIEF_HOME="${DAILY_BRIEF_HOME:-.daily-brief}"
DAILY_BRIEF_SKILL_DIR="${DAILY_BRIEF_SKILL_DIR:-.claude/skills/daily-brief}"
mkdir -p "$BRIEF_HOME/tmp"
python3 "$DAILY_BRIEF_SKILL_DIR/scripts/rss_digest.py" \
  --blacklist "$BRIEF_HOME/tmp/url-blacklist" \
  --output "$BRIEF_HOME/tmp/rss-radar.md" \
  --json-output "$BRIEF_HOME/tmp/rss-radar.json" \
  --max-age-hours 96 \
  --limit 50
```

RSS rules:

- `assets/rss-feeds.json` is a neutral starter registry. Users can append personal feeds, keywords, and weights with `.daily-brief/config/rss-feeds.json`.
- A candidate's score is `base_weight + freshness + interest_keyword_hits - downrank_keyword_hits`.
- Include candidates only when they match the current topic/profile and add useful signal.
- Open or otherwise verify original sources before citing them in the final brief.
- Put RSS items into the relevant thematic section; do not mechanically copy the radar output.

### 3.1 last30days Deep Signal

Use `last30days` for recent community discussion around the user's interests. Run one query per selected topic or subtopic:

```bash
bash "$DAILY_BRIEF_SKILL_DIR/scripts/run_last30days.sh" \
  "<user topic or subtopic>" \
  "<slug>"
```

For broad interest profiles, create 2-4 subtopics that cover the user's stated scope without forcing a fixed domain. Examples:

- `electric vehicles battery supply chain`
- `indie games steam launches`
- `local restaurants openings reviews`
- `AI developer tools` only when the user asked for AI/developer tooling

Use each result sparingly:

- Extract at most 2-4 repeated signals per file.
- Prefer real user/operator quotes, repeated pain points, strong objections, and newly forming demand.
- Do not paste `last30days` output wholesale.
- If it fails, write `> Data unavailable (last30days failed: <reason>)` in the relevant section and continue.

### 3.2 Source Selection Buckets

Choose source buckets from the user's topic/profile. Use only buckets that fit the brief; do not force fixed platforms, communities, industries, or business categories into every run.

1. **Source-of-truth updates** — official pages, changelogs, release notes, public notices, event pages, docs, papers, venue pages, or product pages that directly confirm what changed.
2. **Reliable general coverage** — reputable newsrooms, trade publications, newsletters, local media, or topic-specific magazines that summarize recent developments with editorial standards.
3. **Community and user discussion** — forums, review sites, social posts, Q&A threads, comments, or `last30days` outputs that show what real people are asking, praising, rejecting, or struggling with.
4. **Expert and practitioner commentary** — named practitioners, researchers, creators, analysts, operators, or organizations relevant to this topic. Select them per run; do not use a fixed person list.
5. **Public records and structured data** — public datasets, statistics pages, leaderboards, calendars, directories, registries, price/history pages, issue trackers, or other structured sources that help verify scale, timing, or momentum.
6. **Useful resources and artifacts** — guides, tools, papers, maps, repositories, downloads, templates, videos, or collections only when they help the reader act on the topic.

Run retrieval sequentially across buckets. If a provider rate-limits, wait 30 seconds and retry once. On a second failure, write a `Data unavailable` line for that bucket and continue.

### Content Freshness

- Do not cite URLs from `.daily-brief/tmp/url-blacklist` unless the item is a meaningful update to a continuing story.
- Do not mention a project/person/company unless there is a concrete new signal in the selected window.
- Do not let a single keyword dominate the whole brief; keep the search aligned with the user's actual interest profile.
- Every citation should include a date: `[source](url) (YYYY-MM-DD)`. If the page has no clear date, say `(date unclear)`.

### Writing Constraints

- Match the user's language when clear; otherwise write in concise Chinese.
- Make the brief useful for decisions: what changed, why it matters, what to watch next.
- Keep source links close to the claims they support.
- Prefer fewer high-signal items over broad low-value coverage.
- Finish with a short self-check.

### Output Template

Write the brief to `${DAILY_BRIEF_HOME:-.daily-brief}/briefings/$(date +%Y-%m-%d).md`.

```markdown
# [DAILY-BRIEF] YYYY-MM-DD — <topic/profile>

## TL;DR
- <highest-signal judgment>。[source](url) (YYYY-MM-DD)
- ...

## 1. Recent Signals
- **<item>** — <what changed and why it matters>。[source](url) (YYYY-MM-DD)
- ...

## 2. Community / 30-day Signals
- **<theme>** — <repeated user/operator signal and implication>。[source](url) (YYYY-MM-DD)
- ...

## 3. Primary Sources
- **<source/event>** — <verified primary-source takeaway>。[source](url) (YYYY-MM-DD)
- ...

## 4. Tools / Projects / Resources
- **<resource>** — <why it matters for this topic>。[source](url) (YYYY-MM-DD)
- ...

## 5. Watchlist
- <near-term event, open question, or follow-up query>
- ...

## Self-check
- [ ] Matches the requested topic/profile
- [ ] No repeated URLs from the latest three briefs unless intentionally updated
- [ ] Each substantive claim has a source and date or a clear date-unclear note
- [ ] RSS Radar and last30days outputs were read or their failure was noted
- [ ] No stale filler or fixed-domain assumptions
```

Keep sections that have evidence. If a section does not fit the topic, omit it rather than padding.

---

## 4) Failure Modes

- **Prereq missing for research** → print the install hint and stop.
- **Python 3.12+ missing** → install Python 3.12+ or set `PYTHON=/path/to/python3.12`.
- **bundled last30days missing** → the skill package is incomplete; verify `vendor/last30days/scripts/last30days.py`.
- **Existing same-day brief** → reuse, back up before regenerate, or stop based on the user's current intent.
