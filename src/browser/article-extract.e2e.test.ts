import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtractArticleJs, type ExtractArticleOptions, type ExtractedArticle } from './article-extract.js';
import { downloadArticle } from '../download/article-download.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '__fixtures__', 'article-extract');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!));
}

function runExtract(
  html: string,
  url: string,
  options: ExtractArticleOptions = {},
  contentType?: string,
): ExtractedArticle | null {
  const dom = new JSDOM(html, {
    url,
    contentType: 'text/html',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  if (contentType) {
    Object.defineProperty(dom.window.document, 'contentType', {
      value: contentType,
      configurable: true,
    });
  }
  return dom.window.eval(buildExtractArticleJs(options)) as ExtractedArticle | null;
}

async function renderMarkdown(
  article: ExtractedArticle,
  url: string,
  options: { cleanSelectors?: string[] } = {},
): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-article-e2e-'));
  tempDirs.push(tempDir);
  const result = await downloadArticle({
    title: article.title || 'untitled',
    contentHtml: article.html,
    sourceUrl: url,
  }, {
    output: tempDir,
    downloadImages: false,
    cleanSelectors: options.cleanSelectors,
  });
  expect(result[0].status).toBe('success');
  return fs.readFileSync(result[0].saved, 'utf8');
}

describe('article extract → markdown e2e fixtures', () => {
  it('extracts a Wikipedia article fixture and keeps infobox/reference noise out of markdown', async () => {
    const url = 'https://en.wikipedia.org/wiki/Markdown';
    const cleanSelectors = ['.infobox', '.navbox', '.reference', '.mw-editsection', '.metadata'];
    const article = runExtract(loadFixture('wikipedia-markdown.html'), url, { cleanSelectors });
    expect(article?.source).toBe('readability');
    expect(article?.title).toBe('Markdown');
    if (!article) throw new Error('expected extracted article');

    const md = await renderMarkdown(article, url, { cleanSelectors });
    expect(md).toContain('lightweight markup language');
    expect(md).toContain('John Gruber');
    expect(md).not.toContain('Syntax description');
    expect(md).not.toContain('Standard file extension');
  });

  it('extracts a Deno blog fixture, preserves embedded iframes as markdown links, and drops page chrome', async () => {
    const url = 'https://deno.com/blog/v2.0';
    const article = runExtract(loadFixture('deno-v2.html'), url);
    expect(article?.source).toBe('readability');
    expect(article?.title).toBe('Announcing Deno 2 | Deno');
    if (!article) throw new Error('expected extracted article');

    const md = await renderMarkdown(article, url);
    expect(md).toContain('## Announcing Deno 2');
    expect(md).toContain('The web is humanity’s largest software platform');
    expect(md).toMatch(/\]\(https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[^)]+\)/);
    expect(md).not.toContain('Skip to main content');
  });

  it('short-circuits non-HTML raw text pages end-to-end', async () => {
    const url = 'https://raw.githubusercontent.com/openai/openai-cookbook/main/README.md';
    const text = loadFixture('openai-cookbook-readme.txt');
    const html = `<html><head><title>OpenAI Cookbook README</title></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
    const article = runExtract(html, url, {}, 'text/plain');
    expect(article?.source).toBe('raw-text');
    if (!article) throw new Error('expected extracted article');

    const md = await renderMarkdown(article, url);
    expect(md).toContain('OPENAI\\_API\\_KEY');
    expect(md).toContain('Example code and guides for accomplishing common tasks');
  });

  it('short-circuits a single-pre document end-to-end', async () => {
    const url = 'https://raw.githubusercontent.com/openai/openai-cookbook/main/README.md';
    const text = loadFixture('openai-cookbook-readme.txt');
    const html = `<html><head><title>OpenAI Cookbook README</title></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
    const article = runExtract(html, url);
    expect(article?.source).toBe('pre');
    if (!article) throw new Error('expected extracted article');

    const md = await renderMarkdown(article, url);
    expect(md).toContain('OPENAI\\_API\\_KEY');
    expect(md).toContain('Most code examples are written in Python');
  });
});
