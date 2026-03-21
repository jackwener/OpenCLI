/**
 * Tests for dom-snapshot.ts: DOM snapshot engine.
 *
 * Since the engine generates JavaScript strings for in-page evaluation,
 * these tests validate:
 * 1. The generated code is syntactically valid JS
 * 2. Options are correctly embedded
 * 3. The output structure matches expected format
 * 4. All features are present (Shadow DOM, iframe, table, diff, etc.)
 */

import { describe, it, expect } from 'vitest';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';

describe('generateSnapshotJs', () => {
  it('returns a non-empty string', () => {
    const js = generateSnapshotJs();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(100);
  });

  it('generates syntactically valid JS (can be parsed)', () => {
    const js = generateSnapshotJs();
    expect(() => new Function(js)).not.toThrow();
  });

  it('embeds default options correctly', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('VIEWPORT_EXPAND = 800');
    expect(js).toContain('MAX_DEPTH = 50');
    expect(js).toContain('INTERACTIVE_ONLY = false');
    expect(js).toContain('MAX_TEXT_LEN = 120');
    expect(js).toContain('INCLUDE_SCROLL_INFO = true');
    expect(js).toContain('BBOX_DEDUP = true');
    expect(js).toContain('INCLUDE_SHADOW_DOM = true');
    expect(js).toContain('INCLUDE_IFRAMES = true');
    expect(js).toContain('PAINT_ORDER_CHECK = true');
    expect(js).toContain('ANNOTATE_REFS = true');
    expect(js).toContain('REPORT_HIDDEN = true');
    expect(js).toContain('FILTER_ADS = true');
    expect(js).toContain('MARKDOWN_TABLES = true');
    expect(js).toContain('PREV_HASHES = null');
  });

  it('embeds custom options correctly', () => {
    const js = generateSnapshotJs({
      viewportExpand: 2000,
      maxDepth: 30,
      interactiveOnly: true,
      maxTextLength: 200,
      includeScrollInfo: false,
      bboxDedup: false,
      includeShadowDom: false,
      includeIframes: false,
      maxIframes: 3,
      paintOrderCheck: false,
      annotateRefs: false,
      reportHidden: false,
      filterAds: false,
      markdownTables: false,
    });
    expect(js).toContain('VIEWPORT_EXPAND = 2000');
    expect(js).toContain('MAX_DEPTH = 30');
    expect(js).toContain('INTERACTIVE_ONLY = true');
    expect(js).toContain('MAX_TEXT_LEN = 200');
    expect(js).toContain('INCLUDE_SCROLL_INFO = false');
    expect(js).toContain('BBOX_DEDUP = false');
    expect(js).toContain('INCLUDE_SHADOW_DOM = false');
    expect(js).toContain('INCLUDE_IFRAMES = false');
    expect(js).toContain('MAX_IFRAMES = 3');
    expect(js).toContain('PAINT_ORDER_CHECK = false');
    expect(js).toContain('ANNOTATE_REFS = false');
    expect(js).toContain('REPORT_HIDDEN = false');
    expect(js).toContain('FILTER_ADS = false');
    expect(js).toContain('MARKDOWN_TABLES = false');
  });

  it('clamps maxDepth between 1 and 200', () => {
    expect(generateSnapshotJs({ maxDepth: -5 })).toContain('MAX_DEPTH = 1');
    expect(generateSnapshotJs({ maxDepth: 999 })).toContain('MAX_DEPTH = 200');
    expect(generateSnapshotJs({ maxDepth: 75 })).toContain('MAX_DEPTH = 75');
  });

  it('wraps output as an IIFE', () => {
    const js = generateSnapshotJs();
    expect(js.startsWith('(() =>')).toBe(true);
    expect(js.trimEnd().endsWith(')()')).toBe(true);
  });

  it('embeds previousHashes for incremental diff', () => {
    const hashes = JSON.stringify(['12345', '67890']);
    const js = generateSnapshotJs({ previousHashes: hashes });
    expect(js).toContain('new Set(["12345","67890"])');
  });

  it('includes all core features in generated code', () => {
    const js = generateSnapshotJs();

    // Tag filtering
    expect(js).toContain('SKIP_TAGS');
    expect(js).toContain("'script'");
    expect(js).toContain("'style'");

    // SVG collapsing
    expect(js).toContain('SVG_CHILDREN');

    // Interactive detection
    expect(js).toContain('INTERACTIVE_TAGS');
    expect(js).toContain('INTERACTIVE_ROLES');
    expect(js).toContain('isInteractive');

    // Visibility
    expect(js).toContain('isVisibleByCSS');
    expect(js).toContain('isInExpandedViewport');

    // BBox dedup
    expect(js).toContain('isContainedBy');
    expect(js).toContain('PROPAGATING_TAGS');

    // Shadow DOM
    expect(js).toContain('shadowRoot');
    expect(js).toContain('|shadow|');

    // iframe
    expect(js).toContain('walkIframe');
    expect(js).toContain('|iframe|');

    // Paint order
    expect(js).toContain('isOccludedByOverlay');
    expect(js).toContain('elementFromPoint');

    // Ad filtering
    expect(js).toContain('isAdElement');
    expect(js).toContain('AD_PATTERNS');

    // data-ref annotation
    expect(js).toContain('data-opencli-ref');

    // Hidden elements report
    expect(js).toContain('hiddenInteractives');
    expect(js).toContain('hidden_interactive');

    // Incremental diff
    expect(js).toContain('hashElement');
    expect(js).toContain('currentHashes');
    expect(js).toContain('__opencli_prev_hashes');

    // Table serialization
    expect(js).toContain('serializeTable');
    expect(js).toContain('|table|');

    // Synthetic attributes
    expect(js).toContain("'YYYY-MM-DD'");
    expect(js).toContain('value=••••');

    // Page metadata
    expect(js).toContain('location.href');
    expect(js).toContain('document.title');
  });

  it('contains proper attribute whitelist', () => {
    const js = generateSnapshotJs();
    const expectedAttrs = [
      'aria-label', 'aria-expanded', 'aria-checked', 'aria-selected',
      'placeholder', 'href', 'role', 'data-testid', 'autocomplete',
    ];
    for (const attr of expectedAttrs) {
      expect(js).toContain(`'${attr}'`);
    }
  });

  it('includes scroll info formatting', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('scrollHeight');
    expect(js).toContain('scrollTop');
    expect(js).toContain('|scroll|');
    expect(js).toContain('page_scroll');
  });
});

describe('scrollToRefJs', () => {
  it('generates valid JS', () => {
    const js = scrollToRefJs('42');
    expect(() => new Function(js)).not.toThrow();
  });

  it('targets data-opencli-ref', () => {
    const js = scrollToRefJs('7');
    expect(js).toContain('data-opencli-ref');
    expect(js).toContain('scrollIntoView');
    expect(js).toContain('"7"');
  });

  it('falls back to data-ref', () => {
    const js = scrollToRefJs('3');
    expect(js).toContain('data-ref');
  });

  it('returns scrolled info', () => {
    const js = scrollToRefJs('1');
    expect(js).toContain('scrolled: true');
    expect(js).toContain('tag:');
  });
});

describe('getFormStateJs', () => {
  it('generates valid JS', () => {
    const js = getFormStateJs();
    expect(() => new Function(js)).not.toThrow();
  });

  it('collects form elements', () => {
    const js = getFormStateJs();
    expect(js).toContain('document.forms');
    expect(js).toContain('form.elements');
  });

  it('collects orphan fields', () => {
    const js = getFormStateJs();
    expect(js).toContain('orphanFields');
    expect(js).toContain('el.form');
  });

  it('handles different input types', () => {
    const js = getFormStateJs();
    expect(js).toContain('checkbox');
    expect(js).toContain('radio');
    expect(js).toContain('password');
    expect(js).toContain('contenteditable');
  });

  it('extracts labels', () => {
    const js = getFormStateJs();
    expect(js).toContain('aria-label');
    expect(js).toContain('label[for=');
    expect(js).toContain('closest');
    expect(js).toContain('placeholder');
  });

  it('masks passwords', () => {
    const js = getFormStateJs();
    expect(js).toContain('••••');
  });

  it('includes data-opencli-ref in output', () => {
    const js = getFormStateJs();
    expect(js).toContain('data-opencli-ref');
  });
});
