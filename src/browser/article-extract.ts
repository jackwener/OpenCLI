/**
 * Article extraction via Readability — generic `page → article HTML` pipeline.
 *
 * Complements `src/browser/extract.ts`: that one takes a caller-supplied
 * selector. This one works with zero configuration on arbitrary article pages
 * (blogs, news, docs) by running `@mozilla/readability` inside the page
 * context via CDP evaluate.
 *
 * Pipeline:
 *   1. Short-circuit non-HTML documents (`text/plain`, JSON, XML) — a page
 *      renderer wrapping a plain-text file would pollute the DOM pipeline.
 *   2. Short-circuit the "body is a single <pre>" case, which browsers use
 *      when loading *.txt / *.md over file:// or raw.githubusercontent.com.
 *   3. Deep-clone the document, apply caller-supplied `cleanSelectors` to the
 *      clone (preserves live page state for subsequent snapshot/click).
 *   4. Inject Readability + isProbablyReaderable sources into the page,
 *      parse on the clone. `isProbablyReaderable` gates the parse unless
 *      `force: true`.
 *   5. On Readability miss, walk a fallback selector chain
 *      (main → [role="main"] → #main-content → … → body) and return the
 *      first root with >80 characters of text.
 *
 * Readability runs in the page's own window because it needs real DOM APIs
 * (getComputedStyle, treeWalker). Running it Node-side would require jsdom —
 * a heavy dep the rest of OpenCLI doesn't need.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

let cachedSources: { readability: string; readerable: string } | null = null;

function readabilitySources(): { readability: string; readerable: string } {
  if (cachedSources) return cachedSources;
  const readabilityPath = requireFromHere.resolve('@mozilla/readability/Readability.js');
  const readerablePath = requireFromHere.resolve('@mozilla/readability/Readability-readerable.js');
  cachedSources = {
    readability: fs.readFileSync(readabilityPath, 'utf8'),
    readerable: fs.readFileSync(readerablePath, 'utf8'),
  };
  return cachedSources;
}

export interface ExtractArticleOptions {
  /** CSS selectors removed from the cloned document before Readability runs. */
  cleanSelectors?: string[];
  /** Fallback chain when Readability fails. Defaults to the common structural ids. */
  fallbackSelectors?: string[];
  /** Bypass `isProbablyReaderable` and always attempt a parse. */
  force?: boolean;
}

export type ExtractSource = 'readability' | 'fallback' | 'raw-text' | 'pre';

export interface ExtractedArticle {
  html: string;
  title: string;
  byline?: string;
  publishedTime?: string;
  siteName?: string;
  source: ExtractSource;
}

export const DEFAULT_FALLBACK_SELECTORS: string[] = [
  'main',
  '[role="main"]',
  '#main-content',
  '#main',
  '#content',
  '.content',
  'article',
  'body',
];

const MIN_FALLBACK_TEXT_LENGTH = 80;

/**
 * Build the JS expression evaluated in-page to extract the article. Exported
 * for testability — callers on the host side should use `extractArticle`.
 */
export function buildExtractArticleJs(options: ExtractArticleOptions = {}): string {
  const { readability, readerable } = readabilitySources();
  const cleanSelectors = options.cleanSelectors ?? [];
  const fallbackSelectors = options.fallbackSelectors ?? DEFAULT_FALLBACK_SELECTORS;
  const force = !!options.force;

  // Library sources contain backticks and ${...} fragments, so we embed them
  // as JSON-encoded string literals and eval them inside a Function() scope.
  // This isolates their var declarations from the outer IIFE without polluting
  // window globals.
  const readabilityLit = JSON.stringify(readability);
  const readerableLit = JSON.stringify(readerable);
  const cleanLit = JSON.stringify(cleanSelectors);
  const fallbackLit = JSON.stringify(fallbackSelectors);
  const forceLit = JSON.stringify(force);

  return [
    '(() => {',
    '  const cleanSelectors = ' + cleanLit + ';',
    '  const fallbackSelectors = ' + fallbackLit + ';',
    '  const force = ' + forceLit + ';',
    '  const minFallbackText = ' + MIN_FALLBACK_TEXT_LENGTH + ';',
    '  const readabilitySrc = ' + readabilityLit + ';',
    '  const readerableSrc = ' + readerableLit + ';',
    '',
    '  function escapeHtml(s) {',
    '    return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));',
    '  }',
    '',
    '  // Short-circuit 1: non-HTML document',
    '  const ct = document.contentType || "";',
    '  if (ct && ct !== "text/html" && ct !== "application/xhtml+xml") {',
    '    const body = document.body ? (document.body.textContent || "") : "";',
    '    return { source: "raw-text", html: "<pre>" + escapeHtml(body) + "</pre>", title: document.title || "" };',
    '  }',
    '',
    '  // Short-circuit 2: body is a single <pre>',
    '  if (document.body) {',
    '    const kids = document.body.children;',
    '    if (kids.length === 1 && kids[0] && kids[0].tagName === "PRE") {',
    '      return { source: "pre", html: document.body.outerHTML, title: document.title || "" };',
    '    }',
    '  }',
    '',
    '  // Deep-clone + adapter-supplied dirty-node removal',
    '  const cloneDoc = document.cloneNode(true);',
    '  for (const sel of cleanSelectors) {',
    '    try { for (const n of cloneDoc.querySelectorAll(sel)) n.remove(); }',
    '    catch (e) { /* ignore invalid selector */ }',
    '  }',
    '',
    '  // Inject Readability into an isolated Function scope and extract the',
    '  // constructors we need. Library sources use their own module.exports',
    '  // guard (if typeof module === "object"), which is falsy here.',
    '  const libs = (new Function(',
    '    readabilitySrc + "\\n" + readerableSrc + "\\nreturn {" +',
    '    " Readability: typeof Readability !== \\"undefined\\" ? Readability : null," +',
    '    " isProbablyReaderable: typeof isProbablyReaderable !== \\"undefined\\" ? isProbablyReaderable : null" +',
    '    " };"',
    '  ))();',
    '  const Readability = libs.Readability;',
    '  const isProbablyReaderable = libs.isProbablyReaderable;',
    '',
    '  const readerableOk = force || (typeof isProbablyReaderable === "function" ? isProbablyReaderable(cloneDoc) : true);',
    '  let article = null;',
    '  if (readerableOk && typeof Readability === "function") {',
    '    try { article = new Readability(cloneDoc).parse(); } catch (e) { article = null; }',
    '  }',
    '  if (article && article.content) {',
    '    return {',
    '      source: "readability",',
    '      html: article.content,',
    '      title: article.title || document.title || "",',
    '      byline: article.byline || undefined,',
    '      publishedTime: article.publishedTime || undefined,',
    '      siteName: article.siteName || undefined,',
    '    };',
    '  }',
    '',
    '  // Fallback chain',
    '  for (const sel of fallbackSelectors) {',
    '    let el = null;',
    '    try { el = cloneDoc.querySelector(sel); } catch (e) { continue; }',
    '    if (!el) continue;',
    '    const text = (el.textContent || "").trim();',
    '    if (text.length < minFallbackText) continue;',
    '    return { source: "fallback", html: el.outerHTML, title: document.title || "" };',
    '  }',
    '',
    '  return null;',
    '})()',
  ].join('\n');
}

export interface PageLike {
  evaluate(js: string): Promise<unknown>;
}

/**
 * Run the extract pipeline on the given page. Returns `null` when no usable
 * content is found (Readability miss + empty fallback chain).
 */
export async function extractArticle(
  page: PageLike,
  options: ExtractArticleOptions = {},
): Promise<ExtractedArticle | null> {
  const js = buildExtractArticleJs(options);
  const raw = await page.evaluate(js);
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Partial<ExtractedArticle> & { source?: string };
  if (typeof r.html !== 'string' || typeof r.source !== 'string') return null;
  const source = r.source as ExtractSource;
  return {
    html: r.html,
    title: typeof r.title === 'string' ? r.title : '',
    ...(r.byline && { byline: r.byline }),
    ...(r.publishedTime && { publishedTime: r.publishedTime }),
    ...(r.siteName && { siteName: r.siteName }),
    source,
  };
}
