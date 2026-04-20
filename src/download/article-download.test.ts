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
});
