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

async function runAndRead(contentHtml: string): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-'));
  tempDirs.push(tempDir);
  const result = await downloadArticle({
    title: 'Test Article',
    contentHtml,
  }, {
    output: tempDir,
    downloadImages: false,
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
      // turndown-plugin-gfm@1.0.2 emits single-tilde strikethrough.
      expect(md).toMatch(/~+gone~+/);
      expect(md).toContain('[x] done');
      expect(md).toContain('[ ] todo');
    });

    it('strips script / style / noscript / iframe / form', async () => {
      const md = await runAndRead(
        '<p>keep</p>' +
        '<script>alert(1)</script>' +
        '<style>.x{color:red}</style>' +
        '<noscript>nojs</noscript>' +
        '<iframe src="x"></iframe>' +
        '<form><button>click</button></form>',
      );
      expect(md).toContain('keep');
      expect(md).not.toContain('alert');
      expect(md).not.toContain('color:red');
      expect(md).not.toContain('nojs');
      expect(md).not.toContain('click');
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
  });
});
