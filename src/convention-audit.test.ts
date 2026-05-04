import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderConventionAuditText, runConventionAudit } from './convention-audit.js';

describe('convention audit', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProject(manifest: unknown[], files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-convention-audit-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'clis'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cli-manifest.json'), JSON.stringify(manifest, null, 2));
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, 'clis', relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return root;
  }

  it('reports column, metadata, typed-error, and write-pair violations', () => {
    const root = makeProject([
      {
        site: 'demo',
        name: 'search',
        access: 'read',
        columns: ['id', 'title', 'authorName'],
        sourceFile: 'demo/search.js',
      },
      {
        site: 'demo',
        name: 'like',
        access: 'write',
        sourceFile: 'demo/like.js',
      },
      {
        site: 'demo',
        name: 'missing',
        columns: [],
        sourceFile: 'demo/missing.js',
      },
      {
        site: 'clean',
        name: 'search',
        access: 'read',
        columns: ['id', 'title'],
        sourceFile: 'clean/search.js',
      },
    ], {
      'demo/search.js': `
        export async function run(kwargs) {
          const limit = Math.min(kwargs.limit, 100);
          try {
            await fetch('/items');
          } catch {
            return [];
          }
          rows.push({
            id: item.id,
            title: item.title ?? 'unknown',
            url: item.url,
            authorName: item.authorName,
          });
          return limit;
        }
      `,
      'demo/like.js': 'export async function run() { return { ok: true }; }',
      'demo/missing.js': 'export async function run() { return { ok: true }; }',
      'clean/search.js': 'export async function run() { rows.push({ id: item.id, title: item.title }); }',
    });

    const report = runConventionAudit({ projectRoot: root });
    const category = (rule: string) => report.categories.find((item) => item.rule === rule)!;

    expect(report.ok).toBe(false);
    expect(category('silent-column-drop').violations[0]).toMatchObject({
      command: 'demo/search',
      details: expect.objectContaining({ missing: ['url'] }),
    });
    expect(category('camelCase-in-columns').violations[0]).toMatchObject({
      command: 'demo/search',
      details: { column: 'authorName' },
    });
    expect(category('missing-access-metadata').violations[0]).toMatchObject({ command: 'demo/missing' });
    expect(category('silent-clamp').violations[0]).toMatchObject({ command: 'demo/search' });
    expect(category('silent-empty-fallback').violations[0]).toMatchObject({ command: 'demo/search' });
    expect(category('silent-sentinel').violations[0]).toMatchObject({ command: 'demo/search' });
    expect(category('write-without-delete-pair').violations[0]).toMatchObject({
      command: 'demo/like',
      details: { expected_any_of: ['unlike'] },
    });
  });

  it('supports site and command target filters', () => {
    const root = makeProject([
      { site: 'demo', name: 'search', access: 'read', columns: ['id'], sourceFile: 'demo/search.js' },
      { site: 'other', name: 'search', access: 'read', columns: ['id'], sourceFile: 'other/search.js' },
    ], {
      'demo/search.js': 'export async function run() { rows.push({ id: 1, hidden: true }); }',
      'other/search.js': 'export async function run() { rows.push({ id: 1, hidden: true }); }',
    });

    expect(runConventionAudit({ projectRoot: root, site: 'demo' }).summary.commands).toBe(1);
    expect(runConventionAudit({ projectRoot: root, target: 'other/search' }).summary.commands).toBe(1);
    expect(runConventionAudit({ projectRoot: root, target: 'missing' }).summary.commands).toBe(0);
  });

  it('renders a compact text report', () => {
    const root = makeProject([
      { site: 'demo', name: 'search', access: 'read', columns: ['id'], sourceFile: 'demo/search.js' },
    ], {
      'demo/search.js': 'export async function run() { rows.push({ id: 1 }); }',
    });

    const text = renderConventionAuditText(runConventionAudit({ projectRoot: root }));

    expect(text).toContain('Convention Audit Report');
    expect(text).toContain('OK - no convention violations found.');
  });

  it('scans pipeline map blocks for silent column drops', () => {
    const root = makeProject([
      { site: 'demo', name: 'feed', access: 'read', columns: ['id', 'title'], sourceFile: 'demo/feed.js' },
    ], {
      'demo/feed.js': `
        cli({
          site: 'demo',
          name: 'feed',
          access: 'read',
          columns: ['id', 'title'],
          pipeline: [
            { map: {
              id: '\${{ item.id }}',
              title: '\${{ item.title }}',
              url: '\${{ item.url }}',
            } },
          ],
        });
      `,
    });

    const report = runConventionAudit({ projectRoot: root });
    const violations = report.categories.find((item) => item.rule === 'silent-column-drop')!.violations;

    expect(violations[0]).toMatchObject({
      command: 'demo/feed',
      details: expect.objectContaining({ missing: ['url'] }),
    });
  });

  it('ignores ok:false diagnostic objects when checking emitted rows', () => {
    const root = makeProject([
      { site: 'demo', name: 'search', access: 'read', columns: ['id', 'url'], sourceFile: 'demo/search.js' },
    ], {
      'demo/search.js': `
        export async function run() {
          if (!document.querySelector('.items')) {
            return { ok: false, bodyLen: document.body.innerText.length, sample: document.body.innerText.slice(0, 800), url: location.href };
          }
          return rows.map((row) => ({ id: row.id, url: row.url }));
        }
      `,
    });

    const report = runConventionAudit({ projectRoot: root });
    const violations = report.categories.find((item) => item.rule === 'silent-column-drop')!.violations;

    expect(violations).toEqual([]);
  });

  it('ignores raw intermediate keys when a final mapper converts them into columns', () => {
    const root = makeProject([
      {
        site: 'demo',
        name: 'search',
        access: 'read',
        columns: ['id', 'rating', 'reviews', 'price'],
        sourceFile: 'demo/search.js',
      },
    ], {
      'demo/search.js': `
        export async function run() {
          rows.push({
            id: item.id,
            starClass: item.starClass,
            reviewsRaw: item.reviewsRaw,
            priceRaw: item.priceRaw,
          });
          return rows.map((r) => ({
            id: r.id,
            rating: r.starClass ? Number(r.starClass) / 10 : null,
            reviews: parseReviewCount(r.reviewsRaw),
            price: parsePrice(r.priceRaw),
          }));
        }
      `,
    });

    const report = runConventionAudit({ projectRoot: root });
    const violations = report.categories.find((item) => item.rule === 'silent-column-drop')!.violations;

    expect(violations).toEqual([]);
  });

  it('still reports raw keys emitted directly without a final mapper', () => {
    const root = makeProject([
      { site: 'demo', name: 'search', access: 'read', columns: ['id', 'title'], sourceFile: 'demo/search.js' },
    ], {
      'demo/search.js': `
        export async function run() {
          rows.push({
            id: item.id,
            title: titleRaw,
            titleRaw,
          });
          return rows;
        }
      `,
    });

    const report = runConventionAudit({ projectRoot: root });
    const violations = report.categories.find((item) => item.rule === 'silent-column-drop')!.violations;

    expect(violations[0]).toMatchObject({
      command: 'demo/search',
      details: expect.objectContaining({ missing: ['titleRaw'] }),
    });
  });

  it('only reports empty array fallbacks inside catch blocks', () => {
    const root = makeProject([
      { site: 'demo', name: 'guard', access: 'read', columns: ['id'], sourceFile: 'demo/guard.js' },
      { site: 'demo', name: 'catch', access: 'read', columns: ['id'], sourceFile: 'demo/catch.js' },
    ], {
      'demo/guard.js': 'export async function run() { if (!store) return []; rows.push({ id: 1 }); }',
      'demo/catch.js': 'export async function run() { try { await fetch("/"); } catch (err) { return []; } rows.push({ id: 1 }); }',
    });

    const report = runConventionAudit({ projectRoot: root });
    const violations = report.categories.find((item) => item.rule === 'silent-empty-fallback')!.violations;

    expect(violations.map((violation) => violation.command)).toEqual(['demo/catch']);
  });
});
