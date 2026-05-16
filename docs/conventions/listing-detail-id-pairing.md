# Listing↔detail ID pairing (advisory)

> **Status:** advisory convention, not a CI gate. Use as guidance when
> designing listing columns; an audit script (`npm run advise:listing-id-pairing`)
> can surface candidate listings for human review.

When a site exposes both a **listing-class command** (`search` / `hot` /
`recent` / `top` / `feed` / ...) and a **detail-class command** (`read` /
`paper` / `article` / `job` / `view` / ...), it's usually nicer for agents
if the listing rows include an id-shaped column whose value can be passed
directly into the detail command.

Without that, the agent has to either re-search by title or scrape a URL
out of band to follow up on a listing row.

## Soft convention

> If `<site>` has both a listing command and a detail command, prefer
> giving each listing row a column whose value round-trips into the
> detail command's positional argument.

That column is whatever the detail command expects:

| Site | Listing | Detail | Round-trip column |
|------|---------|--------|-------------------|
| `hackernews` | `top` / `best` / `ask` / `jobs` / `show` / `new` | `read <id>` | `id` |
| `hupu` | `hot` / `search` | `detail <tid>` | `tid` |
| `lobsters` | `hot` / `active` / `newest` / `tag` | `read <id>` | `id` (Lobsters short_id value) |
| `arxiv` | `search` / `recent` | `paper <id>` | `id` |
| `stackoverflow` | `hot` / `search` / `bounties` / `unanswered` | `read <id>` | `id` |
| `openreview` | `search` / `venue` | `paper <id>` / `reviews <forum>` | `id` |
| `devto` | `top` / `tag` / `user` | `read <id>` | `id` |
| `bilibili` | `hot` | `video <bvid>` | `bvid` |
| `reddit` | `hot` | `read <id>` | `id` |
| `bluesky` | `user` | `thread <uri>` | `uri` |
| `1688` | `search` | `item <url-or-offer-id>` | `offer_id` |
| `tieba` | `search` | `read <id>` | `id` |
| `jike` | `feed` / `search` / `user` | `post <id>` | `id` |
| `weibo` | `feed` / `search` | `post <id>` | `id` |

## Why this matters

The agent never has eyes on a webpage. It sees the listing rows as a
plain table of strings. If the listing emits `[rank, title, author, votes]`
and the detail command needs an id, the agent has three bad options:

1. **Re-search by title** — fragile, may hit a different post for ambiguous
   titles, costs an extra round-trip plus quota.
2. **Parse the URL** — assumes URL shape stays stable and is regex-able,
   often breaks across A/B buckets or after a site redesign.
3. **Hand-craft a search** — pure guess; agents trained to do this leak
   the failure mode silently downstream.

Surfacing the id in the listing collapses all three into a single,
unambiguous column.

## Why this is advisory, not a gate

Whether a listing should pair with a detail is a case-by-case product/UX
call. Many legitimate listings genuinely don't pair:

- **Topic-string listings** (`twitter trending`, `weibo hot`) — rows are
  search keywords, not addressable entities.
- **Profile-attribute listings** (`reddit user`, `lesswrong user`,
  `weibo user`) — rows are `[field, value]` pairs of one profile.
- **UI-only sessions** (`discord-app search`, app quick find surfaces)
  — page ids aren't extractable from the rendered DOM.
- **Comment / reply listings** — sub-resources of a parent thread; the
  detail command fetches the parent, not the comment.

A hard CI gate forced authors to either add an artificial id column or
file an exemption with a reason — both of which were higher cognitive cost
than the silent-loss bugs the rule actually catches. See PR #1311 thread
for the broader "anti-pattern vs case-by-case" filter.

## What counts as an "id-shaped column"

The advisory script (`scripts/check-listing-id-pairing.mjs`) considers any
of these column names a valid round-trip handle:

- Exact `id` / `short_id`
- Anything ending in `_id` or `Id` (e.g. `offer_id`, `paperId`)
- Domain-specific ids: `jk` (indeed), `tid` (thread id), `bvid` / `aid`
  (bilibili), `sku` (retail product SKU), `asin` (amazon), `isbn`, `doi`,
  `slug`
- `username` / `handle` (only when the detail command keys off the user
  rather than a post)
- `url` — only when the detail command's positional argument explicitly
  accepts a URL (for example `read <url-or-id>`, `article <url>`, or help
  text such as `Post ID or full URL`). URL is not a valid substitute when
  the detail command only says an id comes "from URL"; callers would still
  need to parse the URL out of band.
- `uri` — for sites whose canonical handle is a URI scheme (e.g.
  Bluesky's `at://did:.../app.bsky.feed.post/...`).

If the natural id for your site is a different shape, add the pattern to
`ID_COLUMN_PATTERNS` in the script.

## How to add an id column to a listing

1. **Find the source field.** Most listing endpoints already include the
   id in their raw response — they're just dropped before the row is
   shaped. Check `func`'s mapper before adding new fetch logic.
2. **Pick the column position.** Convention is `[rank, id, ...rest, url]`
   so identifiers stay near the front and the URL stays last.
3. **Update the docs.** The site's `docs/adapters/browser/<site>.md`
   should list the new column under "Listing columns" and call out that
   it round-trips into the detail command.
4. **Optional: run the advisory script** to confirm the manifest reflects
   the new column.

   ```bash
   npm run advise:listing-id-pairing
   ```

## Advisory script usage

```bash
# Print a report of listings that don't currently carry an id-shaped column.
# Always exits 0 — does not fail CI.
npm run advise:listing-id-pairing
```

The script reads `cli-manifest.json`, so always rebuild the manifest
(`npx tsx src/build-manifest.ts`) after touching adapter columns.

## Related principles

- [`docs/developer/ts-adapter.md`](../developer/ts-adapter.md) — adapter
  authoring conventions, including the required `access: 'read' | 'write'`
  metadata.
- "Output design" reference inside the bundled
  `opencli-adapter-author` skill — column naming, ordering, and id-first
  conventions.
