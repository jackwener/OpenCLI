/**
 * Unified target resolver for browser actions.
 *
 * Resolution pipeline:
 *
 * 1. Input classification: numeric → ref path, CSS-like → CSS path
 * 2. Ref path: lookup by data-opencli-ref, then verify fingerprint
 * 3. CSS path: querySelectorAll + match-count policy (see ResolveOptions)
 * 4. Structured errors:
 *    - numeric: not_found / stale_ref
 *    - CSS:     invalid_selector / selector_not_found / selector_ambiguous
 *               / selector_nth_out_of_range
 *
 * All JS is generated as strings for page.evaluate() — runs in the browser.
 */

export interface ResolveOptions {
  /**
   * When CSS matches multiple elements, pick the element at this 0-based
   * index instead of raising `selector_ambiguous`. Raises
   * `selector_nth_out_of_range` if `nth >= matches.length`.
   */
  nth?: number;
  /**
   * When CSS matches multiple elements, pick the first match instead of
   * raising `selector_ambiguous`. Used by read commands (get text / value /
   * attributes) to deliver a best-effort answer + matches_n in the envelope.
   * Ignored when `nth` is also set (nth wins).
   */
  firstOnMulti?: boolean;
}

/**
 * Generate JS that resolves a target to a single DOM element.
 *
 * Returns a JS expression that evaluates to:
 *   { ok: true, matches_n }                         — success (el stored in `__resolved`)
 *   { ok: false, code, message, hint, candidates, matches_n? }  — structured error
 *
 * The resolved element is stored in `window.__resolved` for downstream helpers.
 */
export function resolveTargetJs(ref: string, opts: ResolveOptions = {}): string {
  const safeRef = JSON.stringify(ref);
  const nthJs = opts.nth !== undefined ? String(opts.nth | 0) : 'null';
  const firstOnMulti = opts.firstOnMulti === true ? 'true' : 'false';
  return `
    (() => {
      const ref = ${safeRef};
      const nth = ${nthJs};
      const firstOnMulti = ${firstOnMulti};
      const identity = window.__opencli_ref_identity || {};

      // ── Classify input ──
      const isNumeric = /^\\d+$/.test(ref);
      const isCssLike = !isNumeric && /^[a-zA-Z#.\\[]/.test(ref);

      if (isNumeric) {
        // ── Ref path ──
        let el = document.querySelector('[data-opencli-ref="' + ref + '"]');
        if (!el) el = document.querySelector('[data-ref="' + ref + '"]');

        if (!el) {
          return {
            ok: false,
            code: 'not_found',
            message: 'ref=' + ref + ' not found in DOM',
            hint: 'The element may have been removed. Re-run \`opencli browser state\` to get a fresh snapshot.',
          };
        }

        // ── Fingerprint verification (identity vector) ──
        const fp = identity[ref];
        if (fp) {
          const tag = el.tagName.toLowerCase();
          const text = (el.textContent || '').trim().slice(0, 30);
          const role = el.getAttribute('role') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const id = el.id || '';
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || '';

          // Hard fail: tag must always match
          const tagMatch = fp.tag === tag;

          // Soft signals: each non-empty stored field that mismatches counts against
          var mismatches = 0;
          var checks = 0;
          if (fp.id) { checks++; if (fp.id !== id) mismatches++; }
          if (fp.testId) { checks++; if (fp.testId !== testId) mismatches++; }
          if (fp.ariaLabel) { checks++; if (fp.ariaLabel !== ariaLabel) mismatches++; }
          if (fp.role) { checks++; if (fp.role !== role) mismatches++; }
          if (fp.text) {
            checks++;
            // Text: allow prefix match (page text can grow), but empty current text never matches
            if (!text || (!text.startsWith(fp.text) && !fp.text.startsWith(text))) mismatches++;
          }

          // Stale if tag changed, or if any uniquely identifying field (id/testId) changed,
          // or if majority of soft signals mismatch
          var isStale = !tagMatch;
          if (!isStale && checks > 0) {
            // id and testId are strong identifiers — any mismatch on these is decisive
            if (fp.id && fp.id !== id) isStale = true;
            else if (fp.testId && fp.testId !== testId) isStale = true;
            // For remaining signals, stale if more than half mismatch
            else if (mismatches > checks / 2) isStale = true;
          }

          if (isStale) {
            return {
              ok: false,
              code: 'stale_ref',
              message: 'ref=' + ref + ' was <' + fp.tag + '>' + (fp.text ? '"' + fp.text + '"' : '')
                + ' but now points to <' + tag + '>' + (text ? '"' + text.slice(0, 30) + '"' : ''),
              hint: 'The page has changed since the last snapshot. Re-run \`opencli browser state\` to refresh.',
            };
          }
        }

        window.__resolved = el;
        return { ok: true, matches_n: 1 };
      }

      if (isCssLike) {
        // ── CSS selector path ──
        let matches;
        try {
          matches = document.querySelectorAll(ref);
        } catch (e) {
          return {
            ok: false,
            code: 'invalid_selector',
            message: 'Invalid CSS selector: ' + ref + ' (' + ((e && e.message) || String(e)) + ')',
            hint: 'Check the selector syntax. Use ref numbers from snapshot for reliable targeting.',
          };
        }

        if (matches.length === 0) {
          return {
            ok: false,
            code: 'selector_not_found',
            message: 'CSS selector "' + ref + '" matched 0 elements',
            hint: 'The element may not exist or may be hidden. Re-run \`opencli browser state\` to check, or use \`opencli browser find --css\` to explore candidates.',
            matches_n: 0,
          };
        }

        if (nth !== null) {
          if (nth < 0 || nth >= matches.length) {
            return {
              ok: false,
              code: 'selector_nth_out_of_range',
              message: 'CSS selector "' + ref + '" matched ' + matches.length + ' elements, but --nth=' + nth + ' is out of range',
              hint: 'Use --nth between 0 and ' + (matches.length - 1) + ', or omit --nth to target the first match (read ops) or require explicit disambiguation (write ops).',
              matches_n: matches.length,
            };
          }
          window.__resolved = matches[nth];
          return { ok: true, matches_n: matches.length };
        }

        if (matches.length > 1 && !firstOnMulti) {
          const candidates = [];
          const limit = Math.min(matches.length, 5);
          for (let i = 0; i < limit; i++) {
            const m = matches[i];
            const tag = m.tagName.toLowerCase();
            const text = (m.textContent || '').trim().slice(0, 40);
            const id = m.id ? '#' + m.id : '';
            candidates.push('<' + tag + id + '>' + (text ? ' "' + text + '"' : ''));
          }
          return {
            ok: false,
            code: 'selector_ambiguous',
            message: 'CSS selector "' + ref + '" matched ' + matches.length + ' elements',
            hint: 'Pass --nth <n> (0-based) to pick one, or use a more specific selector. Use \`opencli browser find --css\` to list all candidates.',
            candidates: candidates,
            matches_n: matches.length,
          };
        }

        // Single match, OR multi-match with firstOnMulti (read path)
        window.__resolved = matches[0];
        return { ok: true, matches_n: matches.length };
      }

      // ── Unrecognized input ──
      return {
        ok: false,
        code: 'not_found',
        message: 'Cannot parse target: ' + ref,
        hint: 'Use a numeric ref from snapshot (e.g. "12") or a CSS selector (e.g. "#submit").',
      };
    })()
  `;
}

/**
 * Generate JS for click that uses the unified resolver.
 * Assumes resolveTargetJs has been called and __resolved is set.
 */
export function clickResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      try {
        el.click();
        return { status: 'clicked', x, y, w: Math.round(rect.width), h: Math.round(rect.height) };
      } catch (e) {
        return { status: 'js_failed', x, y, w: Math.round(rect.width), h: Math.round(rect.height), error: e.message };
      }
    })()
  `;
}

/**
 * Generate JS for type that uses the unified resolver.
 */
export function typeResolvedJs(text: string): string {
  const safeText = JSON.stringify(text);
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      el.focus();
      if (el.isContentEditable) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, ${safeText});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, ${safeText});
        } else {
          el.value = ${safeText};
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return 'typed';
    })()
  `;
}

/**
 * Generate JS for scrollTo that uses the unified resolver.
 * Assumes resolveTargetJs has been called and __resolved is set.
 */
export function scrollResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return { scrolled: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80) };
    })()
  `;
}

/**
 * Generate JS to get text content of resolved element.
 */
export function getTextResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      return el.textContent?.trim() ?? null;
    })()
  `;
}

/**
 * Generate JS to get value of resolved input/textarea element.
 */
export function getValueResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      return el.value ?? null;
    })()
  `;
}

/**
 * Generate JS to get all attributes of resolved element.
 */
export function getAttributesResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      return JSON.stringify(Object.fromEntries([...el.attributes].map(a => [a.name, a.value])));
    })()
  `;
}

/**
 * Generate JS to select an option on a resolved <select> element.
 */
export function selectResolvedJs(option: string): string {
  const safeOption = JSON.stringify(option);
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      if (el.tagName !== 'SELECT') return { error: 'Not a <select>' };
      const match = Array.from(el.options).find(o => o.text.trim() === ${safeOption} || o.value === ${safeOption});
      if (!match) return { error: 'Option not found', available: Array.from(el.options).map(o => o.text.trim()) };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(el, match.value); else el.value = match.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: match.text };
    })()
  `;
}

/**
 * Generate JS to check if resolved element is an autocomplete/combobox field.
 */
export function isAutocompleteResolvedJs(): string {
  return `
    (() => {
      const el = window.__resolved;
      if (!el) return false;
      const role = el.getAttribute('role');
      const ac = el.getAttribute('aria-autocomplete');
      const list = el.getAttribute('list');
      return role === 'combobox' || ac === 'list' || ac === 'both' || !!list;
    })()
  `;
}
