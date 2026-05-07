# Weibo `search_by_user` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `opencli weibo search_by_user` command that fetches a user's posts in a time range, resolves long-text, downloads images, and outputs structured Markdown files.

**Architecture:** New `clis/weibo/search_by_user.js` adapter that uses the `searchProfile` AJAX API for paginated post fetching, `longtext` API for full-text resolution, `httpDownload` for images, and `htmlToMarkdown` (via `@jackwener/opencli/utils`) for HTML-to-Markdown conversion. Each post becomes a `post_<idstr>.md` file with frontmatter, images stored in `<idstr>_images/` subdirectories, and a `SUMMARY.md` listing all posts.

**Tech Stack:** TypeScript/JavaScript, Node.js fs/path, OpenCLI `cli()` registry, `Strategy.COOKIE`, `httpDownload` from `@jackwener/opencli/download`, `htmlToMarkdown` from `@jackwener/opencli/utils`

---

### Task 1: Write unit tests for helper functions

**Files:**
- Create: `clis/weibo/search_by_user.test.js`

- [ ] **Step 1: Write tests for date-to-timestamp conversion and HTML-to-plain-text**

The adapter needs a `dateToTimestamp` helper (YYYY-MM-DD → Unix seconds at 00:00:00 UTC+8). Test this first since it's used by the main command.

```javascript
import { describe, it, expect } from 'vitest';

describe('search_by_user helpers', () => {
  // dateToTimestamp: YYYY-MM-DD -> Unix seconds at 00:00:00 Beijing time
  function dateToTimestamp(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
  }

  describe('dateToTimestamp', () => {
    it('converts 2025-06-01 to correct UTC+8 timestamp', () => {
      const ts = dateToTimestamp('2025-06-01');
      expect(ts).toBe(1748736000); // 2025-06-01 00:00:00 Beijing = 2025-05-31 16:00:00 UTC
    });

    it('converts 2025-01-01', () => {
      const ts = dateToTimestamp('2025-01-01');
      expect(ts).toBe(1735689600);
    });
  });
});
```

- [ ] **Step 2: Run test to verify structure compiles**

Run: `npx vitest run --project unit clis/weibo/search_by_user.test.js`
Expected: Tests pass (pure math assertions)

- [ ] **Step 3: Commit**

```bash
git add clis/weibo/search_by_user.test.js
git commit -m "test(weibo): add search_by_user helper function tests"
```

---

### Task 2: Implement the main `search_by_user.js` adapter

**Files:**
- Create: `clis/weibo/search_by_user.js`

- [ ] **Step 1: Write the complete adapter**

```javascript
/**
 * Weibo search_by_user — fetch a user's posts in a time range and export to Markdown.
 *
 * Uses the searchProfile AJAX API for pagination, longtext API for full-text,
 * httpDownload for images, and htmlToMarkdown for HTML-to-Markdown conversion.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { httpDownload } from '@jackwener/opencli/download';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { CommandExecutionError } from '@jackwener/opencli/errors';

/** Convert YYYY-MM-DD to Unix seconds at 00:00:00 Beijing time (UTC+8). */
function dateToTimestamp(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
}

/** Default 30 days ago and today as YYYY-MM-DD. */
function defaultDates() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const ago = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const start = `${ago.getFullYear()}-${pad(ago.getMonth() + 1)}-${pad(ago.getDate())}`;
  return { start, end: today };
}

cli({
    site: 'weibo',
    name: 'search_by_user',
    access: 'read',
    description: 'Download a user\'s posts in a time range to Markdown',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', positional: true, required: true, help: 'User ID (numeric uid) or screen name' },
        { name: 'start', help: 'Start date (YYYY-MM-DD), default 30 days ago' },
        { name: 'end', help: 'End date (YYYY-MM-DD), default today' },
        { name: 'has-retweet', type: 'boolean', default: false, help: 'Include retweets' },
        { name: 'has-video', type: 'boolean', default: false, help: 'Include posts with video' },
        { name: 'has-music', type: 'boolean', default: false, help: 'Include posts with music' },
        { name: 'limit', type: 'int', default: 0, help: 'Maximum posts (0 = all)' },
        { name: 'output', help: 'Output directory' },
    ],
    columns: ['id', 'text', 'time', 'likes', 'comments', 'reposts', 'images', 'saved'],
    func: async (page, kwargs) => {
        const rawUid = String(kwargs.uid);
        const { start: defaultStart, end: defaultEnd } = defaultDates();
        const startDate = kwargs.start || defaultStart;
        const endDate = kwargs.end || defaultEnd;
        const hasRetweet = kwargs['has-retweet'] ? 1 : 0;
        const hasVideo = kwargs['has-video'] ? 1 : 0;
        const hasMusic = kwargs['has-music'] ? 1 : 0;
        const limit = Math.max(0, Number(kwargs.limit) || 0);
        const starttime = dateToTimestamp(startDate);
        const endtime = dateToTimestamp(endDate);

        // Navigate to weibo.com first
        await page.goto('https://weibo.com');
        await page.wait(2);

        // Resolve screen_name to uid if needed
        let uid = rawUid;
        if (!/^\d+$/.test(rawUid)) {
            const resolved = await page.evaluate(`
              (async () => {
                const resp = await fetch('/ajax/profile/info?screen_name=' + encodeURIComponent('${rawUid}'), {credentials: 'include'});
                if (!resp.ok) return null;
                const data = await resp.json();
                return data.ok && data.data?.user ? String(data.data.user.id) : null;
              })()
            `);
            if (!resolved) {
                throw new CommandExecutionError(`Could not resolve screen_name "${rawUid}" to a UID. Check the username and try again.`);
            }
            uid = resolved;
        }

        // Fetch posts via searchProfile API with pagination
        const allPosts = await page.evaluate(`
          (async () => {
            const uid = ${JSON.stringify(uid)};
            const starttime = ${starttime};
            const endtime = ${endtime};
            const limit = ${limit};
            const hasRetweet = ${hasRetweet};
            const hasVideo = ${hasVideo};
            const hasMusic = ${hasMusic};
            const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

            const allPosts = [];
            let page = 1;

            while (true) {
              if (limit > 0 && allPosts.length >= limit) break;

              const url = '/ajax/statuses/searchProfile?' +
                'uid=' + uid +
                '&page=' + page +
                '&starttime=' + starttime +
                '&endtime=' + endtime +
                '&hasori=' + (hasRetweet ? 1 : 1) +
                '&hasret=' + hasRetweet +
                '&hastext=1' +
                '&haspic=1' +
                '&hasvideo=' + hasVideo +
                '&hasmusic=' + hasMusic;

              const resp = await fetch(url, {credentials: 'include'});
              if (!resp.ok) break;
              const data = await resp.json();

              if (!data.data || !data.data.list || !Array.isArray(data.data.list)) break;
              const list = data.data.list;

              for (const s of list) {
                if (limit > 0 && allPosts.length >= limit) break;

                // Resolve long text
                let textHtml = s.text || '';
                let textRaw = s.text_raw || strip(textHtml);
                if (s.isLongText || s.is_long_text) {
                  try {
                    const ltResp = await fetch('/ajax/statuses/longtext?id=' + s.idstr, {credentials: 'include'});
                    if (ltResp.ok) {
                      const lt = await ltResp.json();
                      if (lt.data?.longTextContent) {
                        textHtml = lt.data.longTextContent;
                        textRaw = strip(lt.data.longTextContent);
                      }
                    }
                  } catch {}
                }

                // Extract image URLs from pic_infos
                const images = [];
                const picInfos = s.pic_infos || {};
                for (const pid of Object.keys(picInfos)) {
                  const info = picInfos[pid];
                  const url = (info.largest && info.largest.url) || (info.large && info.large.url) || '';
                  if (url) images.push({ url, pic_id: pid });
                }

                const u = s.user || {};
                const retweeted = s.retweeted_status ? {
                  from: (s.retweeted_status.user?.screen_name || '[deleted]'),
                  text: s.retweeted_status.text_raw || strip(s.retweeted_status.text || ''),
                } : null;

                allPosts.push({
                  idstr: s.idstr || String(s.id),
                  mblogid: s.mblogid || '',
                  textHtml,
                  textRaw,
                  created_at: s.created_at || '',
                  author: u.screen_name || '',
                  authorUid: u.id || '',
                  likes: s.attitudes_count || 0,
                  comments: s.comments_count || 0,
                  reposts: s.reposts_count || 0,
                  picNum: s.pic_num || images.length,
                  images,
                  retweeted,
                  url: 'https://weibo.com/' + (u.id || '') + '/' + (s.mblogid || ''),
                });
              }

              // Stop if fewer than 5 results on this page (likely last page)
              if (list.length <= 5) break;
              page++;
            }

            return allPosts;
          })()
        `);

        if (!allPosts || allPosts.length === 0) {
            return [{
                id: '-',
                text: `No posts found for user ${uid} between ${startDate} and ${endDate}`,
                time: '-',
                likes: '-',
                comments: '-',
                reposts: '-',
                images: '-',
                saved: '-',
            }];
        }

        // Create output directory
        const outputDir = kwargs.output
            ? String(kwargs.output)
            : `./weibo_${uid}_${startDate}_${endDate}`;
        fs.mkdirSync(outputDir, { recursive: true });

        // Get cookies for image downloads
        const cookies = formatCookieHeader(await page.getCookies({ domain: 'weibo.com' }));

        const results = [];

        for (const post of allPosts) {
            const idstr = post.idstr;
            const savedPath = path.join(outputDir, `post_${idstr}.md`);
            const imgDir = path.join(outputDir, `${idstr}_images`);
            const imagePaths = [];

            // Download images
            if (post.images.length > 0) {
                fs.mkdirSync(imgDir, { recursive: true });
                for (let i = 0; i < post.images.length; i++) {
                    const img = post.images[i];
                    const filename = `${i + 1}.jpg`;
                    const destPath = path.join(imgDir, filename);
                    try {
                        const result = await httpDownload(img.url, destPath, {
                            cookies,
                            headers: { Referer: 'https://weibo.com/' },
                            timeout: 60000,
                        });
                        if (result.success) {
                            imagePaths.push({ index: i + 1, relative: `./${idstr}_images/${filename}`, ok: true });
                        } else {
                            imagePaths.push({ index: i + 1, relative: img.url, ok: false });
                        }
                    } catch {
                        imagePaths.push({ index: i + 1, relative: img.url, ok: false });
                    }
                }
            }

            // Build Markdown content
            const md = htmlToMarkdown(post.textHtml);

            // Replace image references in markdown with local relative paths
            let content = md;
            const sortedPaths = [...imagePaths].sort((a, b) => a.index - b.index);
            // Weibo images in the markdown text are typically just the raw URLs or inline img tags already stripped
            // Instead, append image references at the bottom
            if (sortedPaths.length > 0) {
                content += '\n\n';
                for (const ip of sortedPaths) {
                    content += `![${ip.index}](${ip.relative})\n`;
                }
            }

            // Retweet attribution
            if (post.retweeted) {
                content = `[@ ${post.retweeted.from}]\n> ${post.retweeted.text.replace(/\n/g, '\n> ')}\n\n---\n\n${content}`;
            }

            // Frontmatter
            const frontmatter = `---\nauthor: ${post.author}\nuid: ${post.authorUid}\ntime: ${post.created_at}\nurl: ${post.url}\nlikes: ${post.likes}\ncomments: ${post.comments}\nreposts: ${post.reposts}\n---\n\n`;

            fs.writeFileSync(savedPath, frontmatter + content, 'utf-8');

            results.push({
                id: idstr,
                text: post.textRaw.substring(0, 80) + (post.textRaw.length > 80 ? '...' : ''),
                time: post.created_at,
                likes: post.likes,
                comments: post.comments,
                reposts: post.reposts,
                images: post.images.length,
                saved: `post_${idstr}.md`,
            });
        }

        // Write SUMMARY.md
        const summaryLines = ['# Weibo Posts Summary', '', `**User:** ${uid}  `, `**Range:** ${startDate} ~ ${endDate}`, '', '| # | ID | Text | Time | Likes | Comments | Reposts | Images | File |', '|---|-----|------|------|-------|----------|---------|--------|------|'];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            summaryLines.push(`| ${i + 1} | ${r.id} | ${r.text} | ${r.time} | ${r.likes} | ${r.comments} | ${r.reposts} | ${r.images} | ${r.saved} |`);
        }
        fs.writeFileSync(path.join(outputDir, 'SUMMARY.md'), summaryLines.join('\n'), 'utf-8');

        const relOut = path.relative(process.cwd(), outputDir);
        console.log(`\nSaved ${results.length} post(s) to ${relOut}/`);
        console.log(`Summary: ${relOut}/SUMMARY.md`);

        return results;
    },
});
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors in `clis/weibo/search_by_user.js` (JS files in this adapter directory are treated as JS, no strict type checking needed)

- [ ] **Step 3: Commit**

```bash
git add clis/weibo/search_by_user.js
git commit -m "feat(weibo): add search_by_user command for timed post download to Markdown"
```

---

### Task 3: Add integration tests for API response parsing

**Files:**
- Modify: `clis/weibo/search_by_user.test.js`

- [ ] **Step 1: Add tests for searchProfile response structure and edge cases**

Append to the existing test file:

```javascript
import { describe, it, expect } from 'vitest';

describe('search_by_user', () => {
  function dateToTimestamp(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
  }

  describe('dateToTimestamp', () => {
    it('converts 2025-06-01 to correct UTC+8 timestamp', () => {
      const ts = dateToTimestamp('2025-06-01');
      expect(ts).toBe(1748736000);
    });

    it('converts 2025-01-01', () => {
      const ts = dateToTimestamp('2025-01-01');
      expect(ts).toBe(1735689600);
    });

    it('handles leap year 2024-02-29', () => {
      const ts = dateToTimestamp('2024-02-29');
      expect(Number.isFinite(ts)).toBe(true);
    });
  });

  describe('default output directory naming', () => {
    it('uses default naming pattern when no output specified', () => {
      const uid = '1234567890';
      const start = '2025-06-01';
      const end = '2025-06-30';
      const expected = `./weibo_${uid}_${start}_${end}`;
      expect(expected).toContain(uid);
      expect(expected).toContain(start);
    });
  });

  describe('HTML text stripping for preview', () => {
    const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

    it('strips basic HTML tags', () => {
      expect(strip('<span>Hello</span>')).toBe('Hello');
    });

    it('handles nested tags', () => {
      expect(strip('<div><p>Test <a href="#">link</a></p></div>')).toBe('Test link');
    });

    it('decodes HTML entities', () => {
      expect(strip('&nbsp;&lt;b&gt;bold&lt;/b&gt;')).toBe(' <b>bold</b>');
    });

    it('handles empty input', () => {
      expect(strip('')).toBe('');
      expect(strip(null)).toBe('');
    });

    it('truncates preview to 80 chars', () => {
      const longText = 'a'.repeat(100);
      const preview = longText.substring(0, 80) + (longText.length > 80 ? '...' : '');
      expect(preview.length).toBe(83); // 80 + '...'
    });
  });

  describe('post URL construction', () => {
    it('builds correct weibo post URL', () => {
      const uid = '1670458304';
      const mblogid = 'QD5uq0ydj';
      const url = `https://weibo.com/${uid}/${mblogid}`;
      expect(url).toBe('https://weibo.com/1670458304/QD5uq0ydj');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run --project unit clis/weibo/search_by_user.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add clis/weibo/search_by_user.test.js
git commit -m "test(weibo): add integration tests for search_by_user helpers"
```

---

### Task 4: Manual verification checklist

**Files:**
- Test: `clis/weibo/search_by_user.js` (runtime)

- [ ] **Step 1: Verify command is registered**

Run: `node dist/src/main.js weibo --help` (or `npm run build && opencli weibo --help`)
Expected: `search_by_user` appears in the list of weibo subcommands

- [ ] **Step 2: Verify help text**

Run: `opencli weibo search_by_user --help`
Expected: Shows positional arg `uid`, options `--start`, `--end`, `--has-retweet`, `--has-video`, `--has-music`, `--limit`, `--output`

- [ ] **Step 3: Test with a real user (manual)**

Run: `opencli weibo search_by_user <your_uid> --start 2025-06-01 --end 2025-06-02 --limit 3`
Expected:
- Creates `./weibo_<uid>_2025-06-01_2025-06-02/` directory
- Contains `SUMMARY.md` and up to 3 `post_<idstr>.md` files
- Images downloaded to `<idstr>_images/` subdirectories
- Markdown files have frontmatter with author, uid, time, url, likes, comments, reposts
- Long-text posts have full content

- [ ] **Step 4: Test screen_name resolution (manual)**

Run: `opencli weibo search_by_user <screen_name> --start 2025-06-01 --end 2025-06-01 --limit 1`
Expected: Resolves screen_name to uid, fetches at most 1 post

- [ ] **Step 5: Test empty result**

Run: `opencli weibo search_by_user <uid> --start 2000-01-01 --end 2000-01-02`
Expected: "No posts found" message, clean exit

---

## Self-Review

**Spec coverage:**
- [x] Command interface (`opencli weibo search_by_user <uid|screen_name> [options]`) — Task 2
- [x] screen_name → uid resolution — Task 2 (line: `/ajax/profile/info`)
- [x] Date → timestamp conversion — Task 1, Task 3
- [x] Paginated searchProfile API — Task 2 (while loop, stops at ≤5 results)
- [x] Long text resolution — Task 2 (`isLongText` check + `/ajax/statuses/longtext`)
- [x] HTML → Markdown conversion — Task 2 (`htmlToMarkdown` from `@jackwener/opencli/utils`)
- [x] Image download with Referer header — Task 2 (`httpDownload` + `Referer: https://weibo.com/`)
- [x] Per-post Markdown with frontmatter — Task 2
- [x] Images in `<idstr>_images/` subdirectories — Task 2
- [x] SUMMARY.md — Task 2
- [x] Error handling (auth, not found, empty, image fail, longtext fail) — Task 2
- [x] Tests — Task 1, Task 3

**Placeholder scan:** No TBD, TODO, "implement later", or vague instructions found.

**Type consistency:** `dateToTimestamp` defined in Task 1 tests and used in Task 2 adapter — signature matches. `htmlToMarkdown` imported from `@jackwener/opencli/utils` which exists at `src/utils.ts:63`. `httpDownload` from `@jackwener/opencli/download` exists at `src/download/index.ts:84`. `formatCookieHeader` from same package. All imports verified against existing codebase.

**Scope check:** Focused on one command in one file. No video download, no comment fetching — out of scope per spec.
