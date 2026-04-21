/**
 * `browser find --css <sel>` — structured CSS query.
 *
 * Returns every match of a selector as a JSON envelope agents can read
 * without parsing free-text snapshot output. Each entry carries two
 * identifiers — the original `data-opencli-ref` (if the element was
 * tagged during an earlier snapshot) and a stable 0-based `nth` — so
 * the agent can act on a specific result via either path:
 *
 *   browser click <ref>              // when ref is numeric
 *   browser click "<sel>" --nth <n>  // always works
 *
 * Attributes are whitelisted to keep output small and high-signal.
 * Invisible elements are still returned so agents can reason about
 * offscreen vs truly-missing targets.
 */

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
  /** Numeric data-opencli-ref if the element was tagged by a prior snapshot; null otherwise. */
  ref: number | null;
  tag: string;
  role: string;
  text: string;
  attrs: Record<string, string>;
  visible: boolean;
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

      const take = Math.min(matches.length, LIMIT);
      const entries = [];
      for (let i = 0; i < take; i++) {
        const el = matches[i];
        const refAttr = el.getAttribute('data-opencli-ref');
        const refNum = refAttr != null && /^\\d+$/.test(refAttr) ? parseInt(refAttr, 10) : null;
        const text = (el.textContent || '').trim();
        entries.push({
          nth: i,
          ref: refNum,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text,
          attrs: pickAttrs(el),
          visible: isVisible(el),
        });
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
