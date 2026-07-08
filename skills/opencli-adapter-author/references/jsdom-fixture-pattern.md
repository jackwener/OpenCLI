# JSDOM-against-frozen-fixture pattern (for in-browser DOM extractors)

## When this pattern applies

You're writing an adapter where the data extraction happens **inside the
live browser** via `page.evaluate(...)` — not in Node-side post-processing.
Typical signal: the adapter has a function literal stringified into
`page.evaluate('(' + fn.toString() + ')()')`, walking `document.querySelector`
and other DOM APIs.

These extractors are invisible to mocked `page.evaluate` unit tests — those
tests feed pre-baked results to the func, so the real DOM walk never runs.
PR #1312 found two such silent in-browser bugs in dianping that only
surfaced on live verify:

1. shop title fallback split on ASCII `[]` while the page renders
   full-width `【】`, so `name` was always empty.
2. `headText.replace(/\s+/g, ' ')` collapsed rating "4.8" with reviews
   "21241条", and a head-wide `/\d+条/` regex captured `4.821241` → 5.

If either category looks plausible for your site, freeze a representative
HTML snapshot and replay it through JSDOM in a unit test.

## File layout

- Test file: `clis/<site>/<site>.test.js` (alongside the adapter file)
- Fixture file: `clis/<site>/__fixtures__/<command>.html`

Reference implementation: `clis/dianping/__fixtures__/{shop,search}.html`
(see PR #1313 for the original test + PR #1318 for the whitespace-strip
follow-up that this doc grew out of).

## Creating the HTML fixture

The whole point is to commit a **representative snapshot of the live
page's DOM** — so the JSDOM unit test exercises the real selector paths
the live extractor walks.

### Mandatory steps (in order)

1. **Capture** the page's HTML from a live verify run:
   ```bash
   opencli browser open https://www.example.com/<page>
   # In another shell, dump page.content():
   opencli browser eval 'document.documentElement.outerHTML' \
     > /tmp/raw-<command>.html
   ```

2. **Strip noise blocks** that JSDOM doesn't need and that change every
   page load (so committed fixtures wouldn't survive a re-capture diff
   anyway):
   - All `<script>...</script>` content
   - All `<style>...</style>` content
   - All `<iframe>...</iframe>` content
   - All `<!-- ... -->` HTML comments
   - All `<link rel="preload" ...>` / tracking pixels

3. **Replace `<img src="...">`** with a placeholder
   (`src="placeholder.png"`) — real CDN URLs leak account-scoped tokens
   and are noise.

4. **Trim to the minimum subtree** that exercises the extractor and
   triggers the bug you're guarding against. For dianping shop, that
   was `.shop-head` + `.desc-info` + `.review-title`; for search,
   3 of 15 result `<li>` cards (rank 1, 2, 3).

5. **MANDATORY whitespace normalization step** — strip all
   whitespace-only lines:
   ```bash
   awk 'NF>0' /tmp/raw-<command>.html > clis/<site>/__fixtures__/<command>.html
   ```
   JSDOM's HTML parser is whitespace-tolerant; blank lines have zero
   semantic effect on the test, but they bloat the committed diff and
   obscure the meaningful DOM subtree from reviewers.
   **Skipping this step is the most common silent quality regression
   in fixture creation.** PR #1318 cleaned 239 leftover blank lines
   from dianping's two fixtures (84.6% / 54.8% of file content) and
   the JSDOM tests still passed unchanged.

6. **Commit** at `clis/<site>/__fixtures__/<command>.html`.

### Anti-patterns to avoid

- ❌ "Strip script/style content" but leave the surrounding newlines.
  Removing inline script body without collapsing the now-blank line is
  the source of the noise — Step 5 exists specifically to clean this up.
- ❌ Trim to minimum subtree, skip Step 5. The fixture works for the
  test but reviewers see hundreds of blank lines.
- ❌ Pretty-print the **mega-line** (e.g. `<div>...</div>` collapsed
  onto one giant line by the source page). Some bugs depend on
  text-node adjacency without intervening whitespace (e.g. `4.8` and
  `21241条` immediately adjacent → `headText` fusion bug). Pretty-print
  inserts whitespace that masks the very condition you're testing for.
  Step 5 only deletes empty lines — never re-flow content.
- ❌ Re-capture from live and overwrite the committed fixture without
  re-running Steps 2-5. The fixture is a **frozen** snapshot; if the
  page layout changes, that's a separate decision (update test
  expectations + re-trim + re-strip).

## Writing the JSDOM unit test

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractShopFields } from './shop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOP_FIXTURE = readFileSync(join(__dirname, '__fixtures__/shop.html'), 'utf8');

describe('shop adapter — extractor against frozen HTML fixture', () => {
    let originalDocument;
    let originalLocation;

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalLocation = globalThis.location;
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        globalThis.location = originalLocation;
    });

    function loadFixture(html, url) {
        const dom = new JSDOM(html, { url });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
        return dom;
    }

    it('extracts the canonical fields and avoids known silent bugs', () => {
        loadFixture(SHOP_FIXTURE, 'https://www.example.com/shop/123');

        const data = extractShopFields();

        expect(data.ok).toBe(true);
        expect(data.name).toBe('...');
        // Add explicit regression guards for each known silent bug.
        expect(data.reviewsRaw).toBe('...');  // not the fused "<rating><reviews>" form
    });
});
```

For this to work, the adapter's extractor must be a **top-level
function** that uses bare `document` / `location` (not `window.document`),
so the same code is exercised by:

- live browser: injected via `${extractFn.toString()}` into
  `page.evaluate`
- JSDOM unit test: with `globalThis.document` swapped

If your adapter currently has the extractor as an IIFE inside a
template literal, refactor to a top-level `export function` first.
Reference: `clis/dianping/{shop,search}.js` extracts `extractShopFields()`
and `extractSearchRows()` with bare `document`/`location`.

## Reverse-validation (mandatory before claiming the test catches the bug)

A test that "passes 18/18" doesn't prove it would have caught the original
bug — only that it agrees with the current implementation. Before
trusting a regression guard:

1. Make a backup of the adapter source.
2. Reintroduce the buggy variant of the relevant extractor.
3. Run the test. It MUST fail with an assertion that points at the
   silent bug.
4. Restore from backup.

For dianping bug #2 (rating/reviews fusion):
```js
// BUGGY VARIANT — replaces the .reviews selector path
const buggyMatch = headText.match(/(\d+)条/);
let reviewsRaw = buggyMatch ? buggyMatch[0] : '';
```

If after Step 5 of fixture creation the test still fails on this buggy
variant with `expected '21241条' to be '21241条'` actually receiving
`'821241条'` (the fused digits), the regression guard is intact. If the
test still passes with the buggy variant, the fixture is too stripped /
normalization went too far / the assertion is too loose — go back and
tighten.

This is the same discipline as `--write-fixture` Step 10 in the main
runbook (verify fixture catches what it should), applied to the JSDOM
HTML fixture instead of the response JSON fixture.

## See also

- `references/adapter-template.md` — basic adapter file structure
- `references/output-design.md` — column naming for the post-extract mapping
- `references/success-rate-pitfalls.md` — broader "verify can pass while
  data is silently wrong" catalog; the mocked-page.evaluate gap that
  motivates this whole pattern is one entry there
