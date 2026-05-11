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
    expect(js).toContain('PROPAGATING_ROLES');
    expect(js).toContain('isBboxPropagator');
    expect(js).toContain('isDistinctivelyInteractive');

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

describe('BBox 99% containment filter', () => {
  it('propagates bbox for both PROPAGATING_TAGS and PROPAGATING_ROLES', () => {
    const js = generateSnapshotJs();
    // Role-based propagator list covers the common wrapper-as-control patterns
    // that show up as <div role=button><svg/><span/></div> on modern SPAs.
    for (const role of ['button', 'link', 'menuitem', 'tab', 'option']) {
      expect(js).toContain(`'${role}'`);
    }
    // propagate site uses the unified helper, not only the tag set
    expect(js).toContain('isBboxPropagator(el, tag)');
  });

  it('suppresses interactive descendants at 0.99 containment when they are not distinctive', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('isContainedBy(rect, parentPropagatingRect, 0.99)');
    expect(js).toContain('!isDistinctivelyInteractive(el)');
    // The suppression path flips the local interactive flag so the node is
    // still emitted (for text / shape) but does not get its own [N] ref.
    expect(js).toContain('interactive = false');
  });

  it('does not suppress inputs / href-bearing anchors even when fully contained', () => {
    const js = generateSnapshotJs();
    // Guards inside isDistinctivelyInteractive
    expect(js).toContain("tag === 'input'");
    expect(js).toContain("tag === 'select'");
    expect(js).toContain("tag === 'textarea'");
    expect(js).toContain("tag === 'a'");
    expect(js).toContain("el.hasAttribute('href')");
    // aria-label / aria-labelledby / id / test-id / name preserve distinctness
    expect(js).toContain("el.hasAttribute('aria-label')");
    expect(js).toContain("el.hasAttribute('aria-labelledby')");
    expect(js).toContain("el.id");
    expect(js).toContain("el.getAttribute('data-testid')");
    expect(js).toContain("el.hasAttribute('name')");
  });

  it('keeps the existing 0.95 non-interactive dedup tier in place', () => {
    const js = generateSnapshotJs();
    // The original non-interactive bbox filter is still present alongside the
    // new interactive tier — two complementary thresholds, not a replacement.
    expect(js).toContain('isContainedBy(rect, parentPropagatingRect, 0.95)');
  });

  it('bbox containment branches are gated on BBOX_DEDUP flag', () => {
    const off = generateSnapshotJs({ bboxDedup: false });
    // When the option is off, the filter becomes inert (BBOX_DEDUP = false)
    // but the inlined helpers still ship — we only guard at the call sites.
    expect(off).toContain('BBOX_DEDUP = false');
    expect(off).toContain('isBboxPropagator');
    expect(off).toContain('isDistinctivelyInteractive');
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

describe('Search Element Detection', () => {
  it('includes SEARCH_INDICATORS set', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('SEARCH_INDICATORS');
    expect(js).toContain('search');
    expect(js).toContain('magnify');
    expect(js).toContain('glass');
  });

  it('includes hasFormControlDescendant function', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('hasFormControlDescendant');
    expect(js).toContain('input');
    expect(js).toContain('select');
    expect(js).toContain('textarea');
  });

  it('includes isSearchElement function', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('isSearchElement');
    expect(js).toContain('className');
    expect(js).toContain('data-');
  });

  it('checks label wrapper detection in isInteractive', () => {
    const js = generateSnapshotJs();
    // Label elements without "for" attribute should check for form control descendants
    expect(js).toContain('hasFormControlDescendant(el, 2)');
  });

  it('checks span wrapper detection in isInteractive', () => {
    const js = generateSnapshotJs();
    // Span elements should check for form control descendants
    expect(js).toContain("tag === 'span'");
  });

  it('integrates search element detection into isInteractive', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('isSearchElement(el)');
  });

  // Blocker B regression: compound contract must be emitted by `browser state`,
  // not only by `browser find --css`. Otherwise agents inspecting the default
  // snapshot still have to round-trip `find` on every date/select/file control.
  it('inlines compoundInfoOf() and attaches compound info to each interactive ref', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('function compoundInfoOf(el)');
    // Wiring: the walk body should call compoundInfoOf on every interactive node
    expect(js).toContain('compoundInfoOf(el)');
    // And collect them into a per-ref map keyed by the same [N] index as the tree
    expect(js).toContain('compoundInfos');
    // And emit a sidecar section after the tree so agents can find the JSON
    expect(js).toContain("'compounds ('");
  });
});
