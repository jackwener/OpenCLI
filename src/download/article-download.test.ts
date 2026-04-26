import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadArticle } from './article-download.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors in tests.
    }
  }
  tempDirs.length = 0;
});

async function runAndRead(
  contentHtml: string,
  opts: { cleanSelectors?: string[] } = {},
): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-'));
  tempDirs.push(tempDir);
  const result = await downloadArticle({
    title: 'Test Article',
    contentHtml,
  }, {
    output: tempDir,
    downloadImages: false,
    ...(opts.cleanSelectors && { cleanSelectors: opts.cleanSelectors }),
  });
  expect(result[0].status).toBe('success');
  return fs.readFileSync(result[0].saved, 'utf8');
}

describe('downloadArticle', () => {
  it('returns the saved markdown file path on success', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-'));
    tempDirs.push(tempDir);

    const result = await downloadArticle({
      title: 'Test Article',
      author: 'Author',
      publishTime: '2026-04-20 12:00:00',
      sourceUrl: 'https://example.com/article',
      contentHtml: '<p>Hello world</p>',
    }, {
      output: tempDir,
      downloadImages: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('success');
    expect(result[0].saved).toMatch(new RegExp(`^${tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(path.extname(result[0].saved)).toBe('.md');
    expect(fs.existsSync(result[0].saved)).toBe(true);
    expect(fs.readFileSync(result[0].saved, 'utf8')).toContain('Hello world');
  });

  describe('markdown pipeline', () => {
    it('converts GFM tables', async () => {
      const md = await runAndRead(
        '<table><thead><tr><th>a</th><th>b</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      );
      expect(md).toMatch(/\|\s*a\s*\|\s*b\s*\|/);
      expect(md).toMatch(/\|\s*---\s*\|\s*---\s*\|/);
      expect(md).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
    });

    it('converts strikethrough and task lists', async () => {
      const md = await runAndRead(
        '<p><del>gone</del></p>' +
        '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>',
      );
      expect(md).toContain('~~gone~~');
      expect(md).toContain('[x] done');
      expect(md).toContain('[ ] todo');
    });

    it('strips script / style / noscript / form but keeps iframe as a link', async () => {
      const md = await runAndRead(
        '<p>keep</p>' +
        '<script>alert(1)</script>' +
        '<style>.x{color:red}</style>' +
        '<noscript>nojs</noscript>' +
        '<iframe src="https://www.youtube.com/embed/abc" title="Demo video"></iframe>' +
        '<form><button>click-in-form</button></form>',
      );
      expect(md).toContain('keep');
      expect(md).not.toContain('alert');
      expect(md).not.toContain('color:red');
      expect(md).not.toContain('nojs');
      // Button inside <form> is stripped because the parent <form> is in STRIPPED_TAGS.
      expect(md).not.toContain('click-in-form');
      // Iframe degrades to a link preserving the embedded URL.
      expect(md).toContain('[Demo video](https://www.youtube.com/embed/abc)');
    });

    it('preserves standalone button text content as inline Markdown', async () => {
      const md = await runAndRead(
        '<h2>2023</h2>' +
        '<button>Download All</button>' +
        '<p>Some article text.</p>' +
        '<button>Copy</button>',
      );
      expect(md).toContain('Download All');
      expect(md).toContain('Copy');
      expect(md).toContain('Some article text.');
    });

    it('drops icon-only buttons that have no visible text', async () => {
      const md = await runAndRead(
        '<p>content</p>' +
        '<button></button>' +
        '<button>   </button>' +
        '<p>after</p>',
      );
      expect(md).toContain('content');
      expect(md).toContain('after');
      // No stray empty button artefacts
      expect(md).not.toMatch(/<button/);
    });

    it('strips SVG nodes entirely', async () => {
      const md = await runAndRead(
        '<p>before</p><svg><circle cx="5" cy="5" r="4"/></svg><p>after</p>',
      );
      expect(md).toContain('before');
      expect(md).toContain('after');
      expect(md).not.toContain('svg');
      expect(md).not.toContain('circle');
    });

    it('drops base64 data URI images but keeps regular images', async () => {
      const md = await runAndRead(
        '<p><img alt="inline" src="data:image/png;base64,iVBORw0KGgo="></p>' +
        '<p><img alt="keep" src="https://example.com/a.jpg"></p>',
      );
      expect(md).not.toContain('data:image');
      expect(md).toContain('![keep](https://example.com/a.jpg)');
    });

    it('collapses 3+ blank lines and strips lone bullet / middle-dot residue', async () => {
      const md = await runAndRead(
        '<p>top</p>' +
        '<p>-</p>' +
        '<p>·</p>' +
        '<p>bottom</p>',
      );
      expect(md).not.toMatch(/\n{3,}/);
      expect(md).not.toMatch(/^\s*-\s*$/m);
      expect(md).not.toMatch(/^\s*·\s*$/m);
      expect(md).toContain('top');
      expect(md).toContain('bottom');
    });

    it('strips page chrome (header / footer / nav / aside)', async () => {
      const md = await runAndRead(
        '<header><p>page-header-text</p></header>' +
        '<nav><a href="/">home-link</a></nav>' +
        '<p>article-body</p>' +
        '<aside><p>sidebar-text</p></aside>' +
        '<footer><p>page-footer-text</p></footer>',
      );
      expect(md).toContain('article-body');
      expect(md).not.toContain('page-header-text');
      expect(md).not.toContain('home-link');
      expect(md).not.toContain('sidebar-text');
      expect(md).not.toContain('page-footer-text');
    });

    it('cleanSelectors removes matching nodes before conversion', async () => {
      const md = await runAndRead(
        '<p>keep-me</p>' +
        '<div class="vote-card">折叠卡</div>' +
        '<section class="reward-panel">赞赏栏</section>' +
        '<p>also-keep</p>',
        { cleanSelectors: ['.vote-card', '.reward-panel'] },
      );
      expect(md).toContain('keep-me');
      expect(md).toContain('also-keep');
      expect(md).not.toContain('折叠卡');
      expect(md).not.toContain('赞赏栏');
    });

    it('cleanSelectors silently ignores invalid selectors', async () => {
      const md = await runAndRead(
        '<p>survives</p><div class="x">and-this-too</div>',
        { cleanSelectors: ['!!!not-a-valid-selector', '.missing'] },
      );
      expect(md).toContain('survives');
      expect(md).toContain('and-this-too');
    });

    it('cleanSelectors keeps valid selectors active when one selector is invalid', async () => {
      const md = await runAndRead(
        '<p>keep</p><div class="vote-card">strip-me</div><p>also-keep</p>',
        { cleanSelectors: ['!!!not-a-valid-selector', '.vote-card'] },
      );
      expect(md).toContain('keep');
      expect(md).toContain('also-keep');
      expect(md).not.toContain('strip-me');
    });

    it('preserves <video> as inline HTML with src + poster', async () => {
      const md = await runAndRead(
        '<p>before</p>' +
        '<video src="https://cdn.example.com/clip.mp4" poster="https://cdn.example.com/poster.jpg"></video>' +
        '<p>after</p>',
      );
      expect(md).toContain('<video src="https://cdn.example.com/clip.mp4" controls poster="https://cdn.example.com/poster.jpg"></video>');
      expect(md).toContain('before');
      expect(md).toContain('after');
    });

    it('falls back to <source> inside <video> when src attribute is absent', async () => {
      const md = await runAndRead(
        '<video><source src="https://cdn.example.com/clip.mp4" type="video/mp4"></video>',
      );
      expect(md).toContain('<video src="https://cdn.example.com/clip.mp4" controls></video>');
    });

    it('drops <video> with no src and no <source>', async () => {
      const md = await runAndRead('<p>before</p><video></video><p>after</p>');
      expect(md).not.toContain('<video');
      expect(md).toContain('before');
      expect(md).toContain('after');
    });

    it('preserves <audio> as inline HTML', async () => {
      const md = await runAndRead(
        '<audio src="https://cdn.example.com/podcast.mp3"></audio>',
      );
      expect(md).toContain('<audio src="https://cdn.example.com/podcast.mp3" controls></audio>');
    });

    it('degrades <iframe> to a markdown link with title', async () => {
      const md = await runAndRead(
        '<iframe src="https://codepen.io/pen/abc" title="Live demo"></iframe>',
      );
      expect(md).toContain('[Live demo](https://codepen.io/pen/abc)');
    });

    it('defaults iframe title to "Embedded content" when missing', async () => {
      const md = await runAndRead(
        '<iframe src="https://example.com/embed"></iframe>',
      );
      expect(md).toContain('[Embedded content](https://example.com/embed)');
    });

    it('drops <iframe> with no src', async () => {
      const md = await runAndRead('<p>before</p><iframe></iframe><p>after</p>');
      expect(md).not.toContain('iframe');
      expect(md).toContain('before');
      expect(md).toContain('after');
    });
  });

  describe('stdout mode', () => {
    it('writes markdown to process.stdout and skips file write', async () => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-'));
      tempDirs.push(tempDir);

      const chunks: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write;

      try {
        const result = await downloadArticle({
          title: 'Piped',
          contentHtml: '<p>Streaming body</p>',
          sourceUrl: 'https://example.com/a',
        }, {
          output: tempDir,
          stdout: true,
        });

        expect(result[0].status).toBe('success');
        expect(result[0].saved).toBe('-');
        expect(fs.readdirSync(tempDir)).toHaveLength(0);

        const emitted = chunks.join('');
        expect(emitted).toContain('# Piped');
        expect(emitted).toContain('Streaming body');
        expect(emitted.endsWith('\n')).toBe(true);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('keeps remote image URLs intact in stdout mode (no download)', async () => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-'));
      tempDirs.push(tempDir);

      const chunks: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write;

      try {
        await downloadArticle({
          title: 'WithImage',
          contentHtml: '<p><img src="https://example.com/a.jpg"></p>',
          imageUrls: ['https://example.com/a.jpg'],
        }, {
          output: tempDir,
          downloadImages: true,
          stdout: true,
        });

        expect(fs.readdirSync(tempDir)).toHaveLength(0);
        expect(chunks.join('')).toContain('https://example.com/a.jpg');
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });
});
