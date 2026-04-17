/**
 * Unified target resolver for browser actions.
 *
 * Replaces the ad-hoc 4-strategy fallback in dom-helpers.ts with a
 * principled resolution pipeline:
 *
 * 1. Input classification: numeric → ref path, CSS-like → CSS path
 * 2. Ref path: lookup by data-opencli-ref, then verify fingerprint
 * 3. CSS path: querySelectorAll + uniqueness check
 * 4. Structured errors: stale_ref / ambiguous / not_found
 *
 * All JS is generated as strings for page.evaluate() — runs in the browser.
 */

/**
 * Generate JS that resolves a target to a single DOM element.
 *
 * Returns a JS expression that evaluates to:
 *   { ok: true, el: Element }                      — success (el is assigned to `__resolved`)
 *   { ok: false, code, message, hint, candidates }  — structured error
 *
 * The resolved element is stored in `__resolved` for the caller to use.
 */
export function resolveTargetJs(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `
    (() => {
      const ref = ${safeRef};
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
        return { ok: true };
      }

      if (isCssLike) {
        // ── CSS selector path ──
        let matches;
        try {
          matches = document.querySelectorAll(ref);
        } catch (e) {
          return {
            ok: false,
            code: 'not_found',
            message: 'Invalid CSS selector: ' + ref,
            hint: 'Check the selector syntax. Use ref numbers from snapshot for reliable targeting.',
          };
        }

        if (matches.length === 0) {
          return {
            ok: false,
            code: 'not_found',
            message: 'CSS selector "' + ref + '" matched 0 elements',
            hint: 'The element may not exist or may be hidden. Re-run \`opencli browser state\` to check.',
          };
        }

        if (matches.length > 1) {
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
            code: 'ambiguous',
            message: 'CSS selector "' + ref + '" matched ' + matches.length + ' elements',
            hint: 'Use a more specific selector, or use ref numbers from \`opencli browser state\` snapshot.',
            candidates: candidates,
          };
        }

        window.__resolved = matches[0];
        return { ok: true };
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
