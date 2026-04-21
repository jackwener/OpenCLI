/**
 * `browser find --css <sel>` — structured CSS query.
 *
 * Returns every match of a selector as a JSON envelope agents can read
 * without parsing free-text snapshot output. Each entry carries two
 * identifiers — a numeric `ref` (matching the snapshot contract) and a
 * stable 0-based `nth` — so the agent can act on a specific result via
 * either path:
 *
 *   browser click <ref>              // when ref is numeric
 *   browser click "<sel>" --nth <n>  // always works
 *
 * Refs are *allocated on the spot* for matched elements that were not
 * tagged by a prior snapshot: `data-opencli-ref` is set on the element
 * and a fingerprint is written into `window.__opencli_ref_identity`
 * (same shape the snapshot uses). That makes `find` a first-class entry
 * point to the ref system — agents can skip running `browser state`
 * when they already know the selector.
 *
 * Attributes are whitelisted to keep output small and high-signal.
 * Invisible elements are still returned so agents can reason about
 * offscreen vs truly-missing targets.
 *
 * When a matched element is a compound form control (date-like input,
 * select, file input), the entry gains a `compound` field with the
 * rich view from `compound.ts`. This is what kills the three biggest
 * agent-fail modes on form pages (wrong date format, guessed options,
 * re-uploaded files) without forcing agents to probe further.
 */

import { COMPOUND_INFO_JS, type CompoundInfo } from './compound.js';

/** Whitelist of attributes surfaced per entry. Keep small; agents do not need full DOM dumps. */
export const FIND_ATTR_WHITELIST = [
  'id',
  'class',
  'name',
  'type',
  'placeholder',
  'aria-label',
  'title',
  'href',
  'value',
  'role',
  'data-testid',
] as const;

export interface FindEntry {
  /** Zero-based position within the match set — pair with `--nth` on downstream commands. */
  nth: number;
  /**
   * Numeric data-opencli-ref. Find assigns one if the element was not
   * tagged by a prior snapshot, so downstream `browser click <ref>` works
   * directly off the find output without requiring `browser state` first.
   */
  ref: number;
  tag: string;
  role: string;
  text: string;
  attrs: Record<string, string>;
  visible: boolean;
  /**
   * Rich view for date / time / datetime-local / month / week / select /
   * file inputs. Omitted (undefined) for all other element types. See
   * `compound.ts` for the shape.
   */
  compound?: CompoundInfo;
}

export interface FindResult {
  matches_n: number;
  entries: FindEntry[];
}

export interface FindError {
  error: {
    code: 'invalid_selector' | 'selector_not_found';
    message: string;
    hint?: string;
  };
}

export interface FindOptions {
  /** Max entries returned. Default 50 — enough to pick from without flooding context. */
  limit?: number;
  /** Max chars of trimmed text per entry. Default 120. */
  textMax?: number;
}

/**
 * Build the browser-side JS that performs the CSS query and emits the
 * FindResult (or FindError) envelope. Evaluated inside `page.evaluate`.
 */
export function buildFindJs(selector: string, opts: FindOptions = {}): string {
  const safeSel = JSON.stringify(selector);
  const limit = opts.limit ?? 50;
  const textMax = opts.textMax ?? 120;
  const whitelist = JSON.stringify(FIND_ATTR_WHITELIST);

  return `
    (() => {
      const sel = ${safeSel};
      const LIMIT = ${limit};
      const TEXT_MAX = ${textMax};
      const ATTR_WHITELIST = ${whitelist};

      ${COMPOUND_INFO_JS}

      let matches;
      try {
        matches = document.querySelectorAll(sel);
      } catch (e) {
        return {
          error: {
            code: 'invalid_selector',
            message: 'Invalid CSS selector: ' + sel + ' (' + ((e && e.message) || String(e)) + ')',
            hint: 'Check the selector syntax.',
          },
        };
      }

      if (matches.length === 0) {
        return {
          error: {
            code: 'selector_not_found',
            message: 'CSS selector ' + sel + ' matched 0 elements',
            hint: 'Use browser state to inspect the page, or try a less specific selector.',
          },
        };
      }

      function pickAttrs(el) {
        const out = {};
        for (const key of ATTR_WHITELIST) {
          const v = el.getAttribute(key);
          if (v != null && v !== '') out[key] = v;
        }
        return out;
      }

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        try {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (parseFloat(style.opacity || '1') === 0) return false;
        } catch (_) {}
        return true;
      }

      // Ref allocation: reuse \`window.__opencli_ref_identity\` (the same map
      // snapshot populates) as the source of truth. For matched elements that
      // don't already carry a \`data-opencli-ref\`, assign the next free numeric
      // ref and write the fingerprint so the target resolver can verify it on
      // downstream click/type/get calls.
      const identity = (window.__opencli_ref_identity = window.__opencli_ref_identity || {});
      let maxRef = 0;
      for (const k in identity) {
        const n = parseInt(k, 10);
        if (!isNaN(n) && n > maxRef) maxRef = n;
      }
      // Also walk any \`data-opencli-ref\` already in the DOM in case the identity
      // map was cleared but annotations remain (e.g. soft navigation without a
      // fresh snapshot). Guarantees allocated refs don't collide.
      try {
        const tagged = document.querySelectorAll('[data-opencli-ref]');
        for (let t = 0; t < tagged.length; t++) {
          const v = tagged[t].getAttribute('data-opencli-ref');
          const n = v != null && /^\\d+$/.test(v) ? parseInt(v, 10) : NaN;
          if (!isNaN(n) && n > maxRef) maxRef = n;
        }
      } catch (_) {}

      function fingerprintOf(el) {
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          text: (el.textContent || '').trim().slice(0, 30),
          ariaLabel: el.getAttribute('aria-label') || '',
          id: el.id || '',
          testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
        };
      }

      const take = Math.min(matches.length, LIMIT);
      const entries = [];
      for (let i = 0; i < take; i++) {
        const el = matches[i];
        const refAttr = el.getAttribute('data-opencli-ref');
        let refNum = refAttr != null && /^\\d+$/.test(refAttr) ? parseInt(refAttr, 10) : null;
        if (refNum === null) {
          refNum = ++maxRef;
          try { el.setAttribute('data-opencli-ref', '' + refNum); } catch (_) {}
          identity['' + refNum] = fingerprintOf(el);
        } else if (!identity['' + refNum]) {
          // Ref annotation survived but identity map was cleared — repopulate so the
          // target resolver's fingerprint check passes on downstream calls.
          identity['' + refNum] = fingerprintOf(el);
        }
        const text = (el.textContent || '').trim();
        const entry = {
          nth: i,
          ref: refNum,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text,
          attrs: pickAttrs(el),
          visible: isVisible(el),
        };
        const compound = compoundInfoOf(el);
        if (compound) entry.compound = compound;
        entries.push(entry);
      }

      return {
        matches_n: matches.length,
        entries,
      };
    })()
  `;
}

export function isFindError(result: unknown): result is FindError {
  return !!result && typeof result === 'object' && 'error' in result;
}
