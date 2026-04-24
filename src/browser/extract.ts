/**
 * `browser extract` — agent-native article/content reading channel.
 *
 * Pipeline (from first principles — agents want the *content*, not the DOM):
 *   1. Scope:    select `--selector` (default: document.body or <main>/<article>)
 *   2. Denoise:  strip script/style/nav/header/footer/aside/iframe/svg/form, inline noise
 *   3. Convert:  HTML → Markdown via shared `htmlToMarkdown` (turndown)
 *   4. Chunk:    paragraph-boundary-aware slicing with `next_start_char` cursor
 *
 * Why a separate command:
 * - `get html --as json` returns tree structure; useless for "read the article".
 * - `get text` flattens everything; loses headings, lists, links.
 * - Markdown is the agent-readable middle ground: structure preserved, noise gone.
 *
 * Continuation contract: the envelope always carries `start`, `end`,
 * `total_chars`, and `next_start_char` (null when the last chunk was emitted).
 * Agents pass `--start <next>` to continue. No session state required.
 */

import { htmlToMarkdown } from '../utils.js';

const DEFAULT_CHUNK_SIZE = 20000;
const MIN_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 200000;
const BOUNDARY_WINDOW_RATIO = 0.15;

/**
 * Returns the JS expression string used with `page.evaluate` to produce the
 * cleaned HTML subtree that we then hand to `htmlToMarkdown`. We do the
 * denoise/clone inside the page so we can use DOM APIs (querySelectorAll,
 * cloneNode) rather than regex on serialized HTML.
 */
export function buildExtractHtmlJs(selector: string | null): string {
    const selectorLiteral = selector ? JSON.stringify(selector) : 'null';
    return `(() => {
  const sel = ${selectorLiteral};
  let root = null;
  if (sel) {
    try { root = document.querySelector(sel); }
    catch (e) {
      return { invalidSelector: true, reason: (e && e.message) || String(e) };
    }
    if (!root) return { notFound: true };
  } else {
    root = document.querySelector('main') || document.querySelector('article') || document.body || document.documentElement;
  }
  if (!root) return { notFound: true };
  const clone = root.cloneNode(true);
  const drop = [
    'script', 'style', 'noscript', 'template',
    'nav', 'header', 'footer', 'aside',
    'iframe', 'svg', 'canvas',
    'form', 'button', 'input', 'select', 'textarea',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
    '[aria-hidden="true"]',
  ];
  for (const q of drop) {
    for (const n of clone.querySelectorAll(q)) n.remove();
  }
  // Also strip event-handler and style attributes that bloat markdown output.
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let n = walker.currentNode;
  while (n) {
    if (n.nodeType === 1) {
      const el = n;
      for (const a of [...el.attributes]) {
        if (a.name.startsWith('on') || a.name === 'style' || a.name.startsWith('data-')) el.removeAttribute(a.name);
      }
    }
    n = walker.nextNode();
  }
  return { ok: true, url: location.href, title: document.title || '', html: clone.outerHTML || '' };
})()`;
}

export interface ExtractChunkOptions {
    content: string;
    start: number;
    chunkSize: number;
}

export interface ExtractChunkResult {
    content: string;
    start: number;
    end: number;
    nextStartChar: number | null;
}

/**
 * Slice `content` into one chunk starting at `start` with target size
 * `chunkSize`. When the chunk would land mid-paragraph, we pull the break
 * back to the nearest `\n\n` (or `\n`) within a small window to keep the
 * output readable. If no boundary is found, we hard-cut at `start+chunkSize`.
 */
export function chunkMarkdown(opts: ExtractChunkOptions): ExtractChunkResult {
    const { content, start } = opts;
    const chunkSize = Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, opts.chunkSize));
    if (start >= content.length) {
        return { content: '', start, end: start, nextStartChar: null };
    }
    const hardEnd = Math.min(content.length, start + chunkSize);
    if (hardEnd === content.length) {
        return { content: content.slice(start, hardEnd), start, end: hardEnd, nextStartChar: null };
    }
    const windowSize = Math.max(1, Math.floor(chunkSize * BOUNDARY_WINDOW_RATIO));
    const windowStart = Math.max(start + 1, hardEnd - windowSize);
    const slice = content.slice(windowStart, hardEnd);
    const paraBreak = slice.lastIndexOf('\n\n');
    let cut = hardEnd;
    if (paraBreak >= 0) {
        cut = windowStart + paraBreak + 2;
    } else {
        const lineBreak = slice.lastIndexOf('\n');
        if (lineBreak >= 0) cut = windowStart + lineBreak + 1;
    }
    return {
        content: content.slice(start, cut),
        start,
        end: cut,
        nextStartChar: cut,
    };
}

export interface RunExtractOptions {
    html: string;
    url: string;
    title: string;
    selector: string | null;
    start: number;
    chunkSize: number;
}

export interface RunExtractResult {
    url: string;
    title: string;
    selector: string | null;
    total_chars: number;
    chunk_size: number;
    start: number;
    end: number;
    next_start_char: number | null;
    content: string;
}

/** End-to-end host-side pipeline: HTML → markdown → chunked envelope. */
export function runExtractFromHtml(opts: RunExtractOptions): RunExtractResult {
    const md = htmlToMarkdown(opts.html);
    const chunk = chunkMarkdown({
        content: md,
        start: Math.max(0, opts.start),
        chunkSize: opts.chunkSize || DEFAULT_CHUNK_SIZE,
    });
    return {
        url: opts.url,
        title: opts.title,
        selector: opts.selector,
        total_chars: md.length,
        chunk_size: chunk.end - chunk.start,
        start: chunk.start,
        end: chunk.end,
        next_start_char: chunk.nextStartChar,
        content: chunk.content,
    };
}

export const __extractInternals = {
    DEFAULT_CHUNK_SIZE,
    MIN_CHUNK_SIZE,
    MAX_CHUNK_SIZE,
};
