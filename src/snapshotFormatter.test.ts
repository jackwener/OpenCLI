/**
 * Tests for snapshotFormatter.ts: snapshot tree filtering.
 *
 * Uses sanitized excerpts from real websites (GitHub, Bilibili, Twitter)
 * to validate noise filtering, annotation stripping, and output quality.
 */

import { describe, it, expect } from 'vitest';
import { formatSnapshot } from './snapshotFormatter.js';

// ---------------------------------------------------------------------------
// Fixtures: sanitized excerpts from real aria snapshots
// ---------------------------------------------------------------------------

/** GitHub dashboard navigation bar (generic-heavy, refs, /url: lines) */
const GITHUB_NAV = `\
- generic [ref=e2]:
  - region
  - generic [ref=e3]:
    - link "Skip to content" [ref=e4] [cursor=pointer]:
      - /url: "#start-of-content"
    - banner "Global Navigation Menu" [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]:
          - button "Open menu" [ref=e12] [cursor=pointer]:
            - img [ref=e13]
          - link "Homepage" [ref=e15] [cursor=pointer]:
            - /url: /
            - img [ref=e16]
        - generic [ref=e18]:
          - navigation "Breadcrumbs" [ref=e19]:
            - list [ref=e20]:
              - listitem [ref=e21]:
                - link "Dashboard" [ref=e22] [cursor=pointer]:
                  - /url: https://github.com/
                  - generic [ref=e23]: Dashboard
          - button "Search or jump to…" [ref=e26] [cursor=pointer]:
            - generic [ref=e27]:
              - generic:
                - img
              - generic [ref=e28]:
                - generic:
                  - text: Type
                  - generic: /
                  - text: to search`;

/** GitHub repo list sidebar (repetitive structure) */
const GITHUB_REPOS = `\
- navigation "Repositories" [ref=e79]:
  - generic [ref=e80]:
    - generic [ref=e81]:
      - heading "Top repositories" [level=2] [ref=e82]
      - link "New" [ref=e83] [cursor=pointer]:
        - /url: /new
        - generic [ref=e84]:
          - generic:
            - img
          - generic [ref=e85]: New
    - search "Top repositories" [ref=e86]:
      - textbox "Find a repository…" [ref=e87]
    - list [ref=e88]:
      - listitem [ref=e89]:
        - generic [ref=e90]:
          - link "Repository" [ref=e91] [cursor=pointer]:
            - /url: /jackwener/twitter-cli
            - img "Repository" [ref=e92]
          - link "jackwener/twitter-cli" [ref=e94] [cursor=pointer]:
            - /url: /jackwener/twitter-cli
      - listitem [ref=e95]:
        - generic [ref=e96]:
          - link "Repository" [ref=e97] [cursor=pointer]:
            - /url: /jackwener/opencli
            - img "Repository" [ref=e98]
          - link "jackwener/opencli" [ref=e100] [cursor=pointer]:
            - /url: /jackwener/opencli`;

/** Bilibili nav bar (Chinese text, multiple link categories) */
const BILIBILI_NAV = `\
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - list [ref=e6]:
        - listitem [ref=e7]:
          - link "首页" [ref=e8] [cursor=pointer]:
            - /url: //www.bilibili.com
            - img [ref=e9]
            - generic [ref=e11]: 首页
        - listitem [ref=e12]:
          - link "番剧" [ref=e13] [cursor=pointer]:
            - /url: //www.bilibili.com/anime/
        - listitem [ref=e14]:
          - link "直播" [ref=e15] [cursor=pointer]:
            - /url: //live.bilibili.com
      - generic [ref=e32]:
        - textbox "冷知识 金廷26年胜率100%" [ref=e34]
        - img [ref=e36] [cursor=pointer]`;

/** Bilibili video card (deeply nested generic wrappers, view counts) */
const BILIBILI_VIDEO = `\
- generic [ref=e363]:
  - link "超酷时刻 即将到来 3.3万 40 16:24" [ref=e364] [cursor=pointer]:
    - /url: https://www.bilibili.com/video/BV1zVw5zoEFt
    - generic [ref=e365]:
      - img "超酷时刻 即将到来" [ref=e368]
      - generic:
        - generic:
          - generic:
            - generic:
              - img
              - generic: 3.3万
            - generic:
              - img
              - generic: "40"
          - generic: 16:24
  - generic [ref=e370]:
    - heading "超酷时刻 即将到来" [level=3] [ref=e371]:
      - link "超酷时刻 即将到来" [ref=e372] [cursor=pointer]:
        - /url: https://www.bilibili.com/video/BV1zVw5zoEFt
    - link "Tesla特斯拉中国 · 13小时前" [ref=e374] [cursor=pointer]:
      - /url: //space.bilibili.com/491190876
      - img [ref=e375]
      - generic "Tesla特斯拉中国" [ref=e379]
      - generic [ref=e380]: · 13小时前`;

/** Empty paragraph blocks (Bilibili bottom section) */
const BILIBILI_EMPTY = `\
- generic [ref=e576]:
  - generic:
    - generic:
      - generic:
        - paragraph
        - paragraph
        - paragraph
- generic [ref=e577]:
  - generic:
    - generic:
      - generic:
        - paragraph
        - paragraph
        - paragraph`;

/** Twitter-style feed item (simulated based on common patterns) */
const TWITTER_TWEET = `\
- main [ref=e100]:
  - region "Timeline" [ref=e101]:
    - article [ref=e200]:
      - generic [ref=e201]:
        - generic [ref=e202]:
          - link "@elonmusk" [ref=e203] [cursor=pointer]:
            - /url: /elonmusk
            - img "@elonmusk" [ref=e204]
          - generic [ref=e205]:
            - generic [ref=e206]: Elon Musk
            - generic [ref=e207]: @elonmusk
        - generic [ref=e208]:
          - generic [ref=e209]: This is a very long tweet that goes on and on about various things including technology, space, and other random topics that make this text exceed any reasonable length limit we might want to set for display purposes in a CLI interface.
        - generic [ref=e210]:
          - button "Reply" [ref=e211] [cursor=pointer]:
            - img [ref=e212]
            - generic [ref=e213]: "42"
          - button "Retweet" [ref=e214] [cursor=pointer]:
            - img [ref=e215]
            - generic [ref=e216]: "1.2K"
          - button "Like" [ref=e217] [cursor=pointer]:
            - img [ref=e218]
            - generic [ref=e219]: "5.3K"
    - separator [ref=e300]`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatSnapshot', () => {
  describe('basic behavior', () => {
    it('returns empty string for empty/null input', () => {
      expect(formatSnapshot('')).toBe('');
      expect(formatSnapshot(null as unknown as string)).toBe('');
      expect(formatSnapshot(undefined as unknown as string)).toBe('');
    });

    it('strips [ref=...] and [cursor=...] annotations', () => {
      const input = '- button "Click me" [ref=e42] [cursor=pointer]';
      const result = formatSnapshot(input);
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('[cursor=');
      expect(result).toContain('button "Click me"');
    });

    it('removes /url: metadata lines', () => {
      const input = `\
- link "Home" [ref=e1] [cursor=pointer]:
  - /url: https://example.com
  - generic [ref=e2]: Home`;
      const result = formatSnapshot(input);
      expect(result).not.toContain('/url:');
      expect(result).not.toContain('https://example.com');
    });

    it('assigns sequential [@N] refs to interactive elements', () => {
      const input = `\
- button "Save" [ref=e1]
- link "Cancel" [ref=e2]
- textbox "Name" [ref=e3]`;
      const result = formatSnapshot(input);
      expect(result).toContain('[@1] button "Save"');
      expect(result).toContain('[@2] link "Cancel"');
      expect(result).toContain('[@3] textbox "Name"');
    });
  });

  describe('noise filtering', () => {
    it('removes generic nodes without text', () => {
      const input = `\
- generic [ref=e1]:
  - generic [ref=e2]:
    - button "Click" [ref=e3]`;
      const result = formatSnapshot(input);
      expect(result).not.toMatch(/^generic/m);
      expect(result).toContain('button "Click"');
    });

    it('keeps generic nodes WITH text content', () => {
      const input = '- generic [ref=e23]: Dashboard';
      const result = formatSnapshot(input);
      expect(result).toContain('generic: Dashboard');
    });

    it('removes img nodes without alt text', () => {
      const input = `\
- img [ref=e13]
- img "Profile photo" [ref=e14]`;
      const result = formatSnapshot(input);
      expect(result).not.toContain('img\n');
      expect(result).toContain('img "Profile photo"');
    });

    it('removes separator nodes', () => {
      const input = '- separator [ref=e304]';
      const result = formatSnapshot(input);
      expect(result).toBe('');
    });

    it('removes presentation/none roles', () => {
      const input = `\
- presentation [ref=e1]
- none [ref=e2]
- button "OK" [ref=e3]`;
      const result = formatSnapshot(input);
      expect(result).not.toContain('presentation');
      expect(result).not.toContain('none');
      expect(result).toContain('button "OK"');
    });
  });

  describe('empty container pruning', () => {
    it('prunes containers with no visible children', () => {
      const input = `\
- list [ref=e88]:
  - listitem [ref=e89]:
    - generic [ref=e90]:
      - img [ref=e91]`;
      // After filtering: generic (no text) → removed, img (no alt) → removed
      // listitem becomes empty → pruned, list becomes empty → pruned
      const result = formatSnapshot(input);
      expect(result).toBe('');
    });

    it('keeps containers with visible children', () => {
      const input = `\
- list [ref=e1]:
  - listitem [ref=e2]:
    - link "Home" [ref=e3]`;
      const result = formatSnapshot(input);
      expect(result).toContain('list');
      expect(result).toContain('listitem');
      expect(result).toContain('link "Home"');
    });
  });

  describe('maxDepth option', () => {
    it('limits output to specified depth', () => {
      const input = `\
- main [ref=e1]:
  - heading "Dashboard" [ref=e2]
  - navigation [ref=e3]:
    - list [ref=e4]:
      - link "Deep link" [ref=e5]`;
      const result = formatSnapshot(input, { maxDepth: 2 });
      expect(result).toContain('main');
      expect(result).toContain('heading "Dashboard"');
      // navigation is pruned: its only child list is empty after link is excluded by maxDepth
      expect(result).not.toContain('navigation');
      expect(result).not.toContain('Deep link');
    });

    it('handles maxDepth=0 correctly (was a bug)', () => {
      const input = `\
- heading "Title" [ref=e1]
  - link "Sub" [ref=e2]`;
      const result = formatSnapshot(input, { maxDepth: 0 });
      expect(result).toContain('heading "Title"');
      expect(result).not.toContain('Sub');
    });
  });

  describe('interactive mode', () => {
    it('keeps interactive elements and landmarks', () => {
      const result = formatSnapshot(GITHUB_NAV, { interactive: true });
      // Interactive elements should be present
      expect(result).toContain('button');
      expect(result).toContain('link');
      // Landmarks preserved
      expect(result).toContain('banner');
      expect(result).toContain('navigation');
    });

    it('filters non-interactive, non-landmark, textless nodes', () => {
      const input = `\
- main [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - button "Save" [ref=e4]
  - generic [ref=e5]: some text content`;
      const result = formatSnapshot(input, { interactive: true });
      expect(result).toContain('main');
      expect(result).toContain('button "Save"');
      // generic with text is kept
      expect(result).toContain('generic: some text content');
    });
  });

  describe('compact mode', () => {
    it('strips bracket annotations and collapses whitespace', () => {
      const input = '- button "Save" [ref=e1] [cursor=pointer] [level=2]';
      const result = formatSnapshot(input, { compact: true });
      // ref/cursor already stripped, but [level=...] should also go in compact
      expect(result).not.toContain('[level=');
      expect(result).toContain('button');
    });
  });

  describe('maxTextLength option', () => {
    it('truncates long content lines', () => {
      const input = '- heading "This is a very long heading that should be truncated at some point" [ref=e1]';
      const result = formatSnapshot(input, { maxTextLength: 30 });
      expect(result.length).toBeLessThanOrEqual(35); // some tolerance for ellipsis
      expect(result).toContain('…');
    });
  });

  // ---------------------------------------------------------------------------
  // Real-world snapshot integration tests
  // ---------------------------------------------------------------------------

  describe('GitHub snapshot', () => {
    it('drastically reduces nav bar output', () => {
      const raw = GITHUB_NAV;
      const rawLineCount = raw.split('\n').length;
      const result = formatSnapshot(raw);
      const resultLineCount = result.split('\n').length;

      // Should significantly reduce line count
      expect(resultLineCount).toBeLessThan(rawLineCount);

      // Key content preserved
      expect(result).toContain('link "Skip to content"');
      expect(result).toContain('banner "Global Navigation Menu"');
      expect(result).toContain('link "Dashboard"');
      expect(result).toContain('button "Search or jump to…"');

      // Noise removed
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('/url:');
    });

    it('preserves repo list structure', () => {
      const result = formatSnapshot(GITHUB_REPOS);
      expect(result).toContain('navigation "Repositories"');
      expect(result).toContain('heading "Top repositories"');
      expect(result).toContain('textbox "Find a repository…"');
      expect(result).toContain('link "jackwener/twitter-cli"');
      expect(result).toContain('link "jackwener/opencli"');
      expect(result).toContain('img "Repository"');

      // No refs or urls
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('/url:');
    });
  });

  describe('Bilibili snapshot', () => {
    it('cleans nav bar with Chinese text', () => {
      const result = formatSnapshot(BILIBILI_NAV);
      expect(result).toContain('link "首页"');
      expect(result).toContain('link "番剧"');
      expect(result).toContain('link "直播"');
      expect(result).toContain('textbox "冷知识 金廷26年胜率100%"');
      expect(result).not.toContain('[ref=');
    });

    it('handles video card with deeply nested wrappers', () => {
      const result = formatSnapshot(BILIBILI_VIDEO);
      expect(result).toContain('link "超酷时刻 即将到来 3.3万 40 16:24"');
      expect(result).toContain('heading "超酷时刻 即将到来"');
      expect(result).toContain('generic "Tesla特斯拉中国"');

      // Deeply nested view count generics with text are kept
      expect(result).toContain('3.3万');
    });

    it('prunes empty paragraph blocks', () => {
      const result = formatSnapshot(BILIBILI_EMPTY);
      // All content is generic (no text) and empty paragraphs
      // After noise filtering, everything should be pruned
      expect(result.trim()).toBe('');
    });
  });

  describe('Twitter snapshot', () => {
    it('preserves tweet structure', () => {
      const result = formatSnapshot(TWITTER_TWEET);
      expect(result).toContain('main');
      expect(result).toContain('region "Timeline"');
      expect(result).toContain('link "@elonmusk"');
      expect(result).toContain('button "Reply"');
      expect(result).toContain('button "Like"');
      expect(result).not.toContain('separator');
    });

    it('truncates long tweet text with maxTextLength', () => {
      const result = formatSnapshot(TWITTER_TWEET, { maxTextLength: 60 });
      // The long tweet text should be truncated
      expect(result).toContain('…');
      // But short elements are unaffected
      expect(result).toContain('button "Reply"');
    });

    it('interactive mode keeps only buttons and links', () => {
      const result = formatSnapshot(TWITTER_TWEET, { interactive: true });
      expect(result).toContain('link "@elonmusk"');
      expect(result).toContain('button "Reply"');
      expect(result).toContain('button "Retweet"');
      expect(result).toContain('button "Like"');
      // Structural landmarks kept
      expect(result).toContain('main');
      expect(result).toContain('region "Timeline"');
      expect(result).toContain('article');
    });

    it('combined options: interactive + maxDepth', () => {
      // With maxDepth: 2 and interactive, depth > 2 is filtered.
      // article at depth 2 has only generic children (noise-filtered),
      // so article gets pruned by container pruning, which cascades up.
      const result = formatSnapshot(TWITTER_TWEET, { interactive: true, maxDepth: 2 });
      expect(result).toContain('main');
      expect(result).not.toContain('button "Reply"');
      expect(result).not.toContain('link "@elonmusk"');
    });
  });

  describe('reduction ratios on real data', () => {
    it('achieves significant reduction on GitHub nav', () => {
      const rawLines = GITHUB_NAV.split('\n').length;
      const formatted = formatSnapshot(GITHUB_NAV);
      const formattedLines = formatted.split('\n').filter(l => l.trim()).length;
      // Expect at least 40% reduction
      expect(formattedLines).toBeLessThan(rawLines * 0.6);
    });

    it('achieves significant reduction on Bilibili video card', () => {
      const rawLines = BILIBILI_VIDEO.split('\n').length;
      const formatted = formatSnapshot(BILIBILI_VIDEO);
      const formattedLines = formatted.split('\n').filter(l => l.trim()).length;
      // Expect at least 30% reduction
      expect(formattedLines).toBeLessThan(rawLines * 0.7);
    });
  });

  // ---------------------------------------------------------------------------
  // Full-page snapshot fixture tests (loaded from __fixtures__/)
  // ---------------------------------------------------------------------------

  describe('full-page snapshots from fixtures', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const fixturesDir = path.join(__dirname, '__fixtures__');

    function loadFixture(name: string): string | null {
      const p = path.join(fixturesDir, name);
      if (!fs.existsSync(p)) return null;
      return fs.readFileSync(p, 'utf-8');
    }

    it('GitHub: significant reduction and clean output', () => {
      const raw = loadFixture('snapshot_github.txt');
      if (!raw) return;
      const rawLines = raw.split('\n').length;
      const result = formatSnapshot(raw);
      const resultLines = result.split('\n').filter((l: string) => l.trim()).length;

      // Should achieve > 50% reduction on GitHub dashboard (heavy generic noise)
      expect(resultLines).toBeLessThan(rawLines * 0.5);

      // No annotations remain
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('[cursor=');
      expect(result).not.toContain('/url:');

      // Key content preserved
      expect(result).toContain('link "Skip to content"');
      expect(result).toContain('banner "Global Navigation Menu"');
      expect(result).toContain('heading "Dashboard"');
    });

    it('Bilibili: significant reduction and Chinese text preserved', () => {
      const raw = loadFixture('snapshot_bilibili.txt');
      if (!raw) return;
      const rawLines = raw.split('\n').length;
      const result = formatSnapshot(raw);
      const resultLines = result.split('\n').filter((l: string) => l.trim()).length;

      // Should achieve > 40% reduction on Bilibili (lots of imgs and generics)
      expect(resultLines).toBeLessThan(rawLines * 0.6);

      // No annotations remain
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('[cursor=');

      // Chinese text preserved
      expect(result).toContain('link "首页"');
      expect(result).toContain('link "番剧"');
    });

    it('Twitter/X: significant reduction and tweet structure preserved', () => {
      const raw = loadFixture('snapshot_twitter.txt');
      if (!raw) return;
      const rawLines = raw.split('\n').length;
      const result = formatSnapshot(raw);
      const resultLines = result.split('\n').filter((l: string) => l.trim()).length;

      // Should achieve > 40% reduction on Twitter/X
      expect(resultLines).toBeLessThan(rawLines * 0.6);

      // No annotations remain
      expect(result).not.toContain('[ref=');
      expect(result).not.toContain('[cursor=');
      expect(result).not.toContain('/url:');

      // Key structure preserved
      expect(result).toContain('main');
    });

    it('GitHub interactive mode: drastic reduction', () => {
      const raw = loadFixture('snapshot_github.txt');
      if (!raw) return;
      const result = formatSnapshot(raw, { interactive: true });
      const resultLines = result.split('\n').filter((l: string) => l.trim()).length;

      // Interactive mode should be much more aggressive
      expect(resultLines).toBeLessThan(200);

      // Interactive elements still present
      expect(result).toContain('button');
      expect(result).toContain('link');
      expect(result).toContain('textbox');
    });

    it('Bilibili maxDepth=3: shallow view', () => {
      const raw = loadFixture('snapshot_bilibili.txt');
      if (!raw) return;
      const result = formatSnapshot(raw, { maxDepth: 3 });
      const resultLines = result.split('\n').filter((l: string) => l.trim()).length;

      // Depth-limited should be very compact
      expect(resultLines).toBeLessThan(50);
    });
  });
});

