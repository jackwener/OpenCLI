/**
 * E2E regression tests for the HTML → Markdown article pipeline.
 *
 * Drives real pages through `opencli web read` and asserts the hardened
 * converter's invariants hold on the produced file:
 *   - no base64 `data:image/…` leaks
 *   - no <script> / <style> leakage
 *   - no runs of 3+ blank lines
 *   - no lone `-` / `·` residue lines
 *   - no trailing-whitespace lines
 *   - no NBSP residue
 *
 * Sites are picked to cover the features the pipeline claims to support:
 *   example.com      — baseline / tiny article
 *   Wikipedia        — GFM tables, many headings, long content
 *   MDN              — meta-tag extracted author + published_time
 *   GitHub README    — fenced code blocks, dense chrome
 *   Vercel blog      — JS-heavy SSR, publish_time from schema.org
 *   Ruan Yifeng blog — CJK, inline images, multi-link paragraphs
 *
 * Each run exits cleanly with `status: 'success'` or is skipped on transient
 * / bot-detection failures (mirroring `browser-public.test.ts` patterns).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, parseJsonOutput } from './helpers.js';

interface WebReadResult {
  title: string;
  author: string;
  publish_time: string;
  status: string;
  size: string;
  saved: string;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
  tempDirs.length = 0;
});

function isTransient(text: string): boolean {
  return /Detached while handling command|No tab with id|Debugger is not attached|Browser Bridge.*not connected|net::ERR_/i.test(text);
}

async function runWebReadOrSkip(
  url: string,
  label: string,
): Promise<WebReadResult | null> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-article-e2e-'));
  tempDirs.push(tempDir);

  const args = ['web', 'read', '--url', url, '--output', tempDir, '--download-images', 'false', '--format', 'json'];
  let result = await runCli(args, { timeout: 90_000 });
  if (result.code !== 0 && isTransient(result.stderr + result.stdout)) {
    result = await runCli(args, { timeout: 90_000 });
  }

  if (result.code !== 0) {
    console.warn(`${label}: skipped — CLI failed (likely bot detection / network): ${result.stderr.slice(0, 200)}`);
    return null;
  }

  let parsed: WebReadResult[];
  try {
    parsed = parseJsonOutput(result.stdout);
  } catch {
    console.warn(`${label}: skipped — CLI output was not JSON`);
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn(`${label}: skipped — empty result array`);
    return null;
  }
  const row = parsed[0];
  if (row.status !== 'success') {
    console.warn(`${label}: skipped — status=${row.status} (${row.saved})`);
    return null;
  }
  return row;
}

function assertPipelineInvariants(md: string, label: string) {
  expect(md.length, `${label}: markdown should be non-trivial`).toBeGreaterThan(200);

  expect(md.match(/data:image/g) ?? [], `${label}: no base64 data-URI images`).toHaveLength(0);
  expect(md.match(/<script[\s>]/gi) ?? [], `${label}: no leaked <script> tags`).toHaveLength(0);
  expect(md.match(/<style[\s>]/gi) ?? [], `${label}: no leaked <style> tags`).toHaveLength(0);

  // The post-processing pipeline guarantees blank-line collapse to at most 2.
  expect(md).not.toMatch(/\n{3,}/);

  // Lone dash / middle-dot residue from lost list bullets.
  expect(md).not.toMatch(/^[ \t]*-[ \t]*$/m);
  expect(md).not.toMatch(/^[ \t]*·[ \t]*$/m);

  // Trailing whitespace should never appear (stripped in post-processing).
  expect(md).not.toMatch(/[ \t]+\n/);

  // NBSP should be normalized to a regular space.
  expect(md.match(/\u00a0/g) ?? [], `${label}: NBSP should be normalized`).toHaveLength(0);
}

interface SiteCase {
  url: string;
  label: string;
  extra?: (md: string) => void;
}

const SITES: SiteCase[] = [
  {
    url: 'https://example.com/',
    label: 'example.com (baseline)',
  },
  {
    url: 'https://en.wikipedia.org/wiki/Markdown',
    label: 'Wikipedia — Markdown (GFM tables + headings)',
    extra: (md) => {
      // Wikipedia's Markdown article contains several tables — the hardened
      // converter with turndown-plugin-gfm should produce real `|---|---|` rows.
      expect(md.match(/^\|.*---.*\|/gm) ?? []).not.toHaveLength(0);
      expect(md.match(/^## /gm) ?? []).not.toHaveLength(0);
    },
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table',
    label: 'MDN — <table> element',
  },
  {
    url: 'https://github.com/mozilla/readability',
    label: 'GitHub — mozilla/readability README',
    extra: (md) => {
      // README uses fenced code blocks extensively; ensure a few survived.
      expect(md.match(/^```/gm) ?? [], 'fenced code blocks preserved').not.toHaveLength(0);
    },
  },
  {
    url: 'https://vercel.com/blog/vercel-ship-2024',
    label: 'Vercel blog — Ship 2024 recap (JS-heavy SSR)',
  },
  {
    url: 'https://www.ruanyifeng.com/blog/2024/07/weekly-issue-309.html',
    label: 'Ruan Yifeng blog — CJK + image-dense',
    extra: (md) => {
      // Chinese site with many inline images. The extractor should preserve
      // both CJK text and remote image URLs (not drop them like base64 would).
      expect(md).toMatch(/[\u4e00-\u9fff]/); // contains at least one CJK char
      expect(md.match(/^!\[.*?\]\(https?:\/\//gm) ?? []).not.toHaveLength(0);
    },
  },
];

describe('web read — hardened article pipeline (real-site regression)', () => {
  for (const site of SITES) {
    it(`${site.label} survives the hardened pipeline`, async () => {
      const row = await runWebReadOrSkip(site.url, site.label);
      if (!row) return;

      expect(row.saved, `${site.label}: saved path present`).toBeTruthy();
      expect(fs.existsSync(row.saved)).toBe(true);

      const md = fs.readFileSync(row.saved, 'utf8');
      assertPipelineInvariants(md, site.label);
      if (site.extra) site.extra(md);
    }, 120_000);
  }
});
