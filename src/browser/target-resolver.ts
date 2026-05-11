/**
 * Unified target resolver for browser actions.
 *
 * Resolution pipeline:
 *
 * 1. Input classification: all-digit → numeric ref path, otherwise → CSS path.
 *    The CSS path passes the raw string to `querySelectorAll` and lets the
 *    browser parser decide what's valid. No frontend regex whitelist — the
 *    goal is that any selector accepted by `browser find --css` is accepted
 *    by the same selector on `get/click/type/select`.
 * 2. Ref path: cascading match levels (see below), using data-opencli-ref
 *    plus the fingerprint map populated by snapshot + find.
 * 3. CSS path: querySelectorAll + match-count policy (see ResolveOptions)
 * 4. Structured errors:
 *    - numeric: not_found / stale_ref
 *    - CSS:     invalid_selector / selector_not_found / selector_ambiguous
 *               / selector_nth_out_of_range
 *
 * All JS is generated as strings for page.evaluate() — runs in the browser.
 *
 * ── Cascading stale-ref (browser-use style) ──────────────────────────
 * Strict equality on the fingerprint rejected too many live pages — SPA
 * re-renders swap text / role while keeping id + testId. The resolver
 * now walks three tiers before giving up:
 *
 *   1. EXACT        — tag + strong id (id or testId) agree, ≤1 soft mismatch
 *   2. STABLE       — tag + strong id agree, soft signals drifted (aria-label,
 *                     role, text) — agent gets a warning but the action
 *                     proceeds so dynamic pages don't stall
 *   3. REIDENTIFIED — original ref either missing from the DOM or fully
 *                     mismatched, but the fingerprint uniquely identifies
 *                     a single other live element via id / testId /
 *                     aria-label. Re-tag that element with the old ref and
 *                     surface match_level so the caller knows we swapped.
 *
 * Only when all three fail do we emit `stale_ref`. Every success envelope
 * carries `match_level` so downstream CLIs can surface the weakest tier
 * a caller actually traversed.
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

/** Tier the resolver traversed to land the target. Callers may surface this to agents. */
export type TargetMatchLevel = 'exact' | 'stable' | 'reidentified';

/**
 * Generate JS that resolves a target to a single DOM element.
 *
 * Returns a JS expression that evaluates to:
 *   { ok: true, matches_n, match_level }            — success (el stored in `__resolved`)
 *   { ok: false, code, message, hint, candidates, matches_n? }  — structured error
 *
 * `match_level` is always set on success:
 *   - CSS path → 'exact'
 *   - numeric ref path → whichever tier matched ('exact' / 'stable' / 'reidentified')
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
      // Numeric = snapshot ref. Everything else is handed to querySelectorAll
      // and whatever the browser parser accepts is a valid selector. No regex
      // shortlist up front: \`find --css\` and \`get/click/type/select\` must agree
      // on the same selector surface (see contract note at the top of this file).
      const isNumeric = /^\\d+$/.test(ref);

      if (isNumeric) {
        // ── Ref path (cascading match levels) ──

        // Shared helper: compute a fingerprint off a live element, same shape
        // snapshot + find populate into \`__opencli_ref_identity\`. Kept inline
        // (not imported) because this source string is compiled standalone.
        function fingerprintOf(node) {
          return {
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role') || '',
            text: (node.textContent || '').trim().slice(0, 30),
            ariaLabel: node.getAttribute('aria-label') || '',
            id: node.id || '',
            testId: node.getAttribute('data-testid') || node.getAttribute('data-test') || '',
          };
        }

        // Classify how strongly a live element matches a stored fingerprint.
        // Returns one of 'exact' | 'stable' | 'mismatch'.
        //
        // 'exact'  — tag + every non-empty stored field agrees (±text prefix).
        // 'stable' — tag agrees AND at least one strong id (id or testId) still
        //            matches; soft signals (aria-label, role, text) may have
        //            drifted. This covers SPA re-render / i18n label swaps.
        // 'mismatch' otherwise.
        function classifyMatch(fp, liveFp) {
          if (fp.tag !== liveFp.tag) return 'mismatch';

          const idMatch = !fp.id || fp.id === liveFp.id;
          const testIdMatch = !fp.testId || fp.testId === liveFp.testId;
          const roleMatch = !fp.role || fp.role === liveFp.role;
          const ariaMatch = !fp.ariaLabel || fp.ariaLabel === liveFp.ariaLabel;
          const textMatch = !fp.text || (
            !!liveFp.text && (liveFp.text.startsWith(fp.text) || fp.text.startsWith(liveFp.text))
          );

          if (idMatch && testIdMatch && roleMatch && ariaMatch && textMatch) return 'exact';

          // Strong id decides: if id + testId still agree and we had at least one
          // of them, accept as stable regardless of soft-signal drift.
          const hadStrongId = !!fp.id || !!fp.testId;
          if (hadStrongId && idMatch && testIdMatch) return 'stable';

          return 'mismatch';
        }

        // Try to recover a stale ref by searching the page for a live element
        // whose fingerprint still matches. Uniqueness is required — if two
        // candidates match equally well, we refuse rather than silently pick
        // the wrong one. Covers ref annotations lost to a re-mount.
        function reidentify(fp) {
          if (!fp) return null;
          const candidates = [];
          function tryAdd(el) {
            if (el && el.nodeType === 1 && classifyMatch(fp, fingerprintOf(el)) !== 'mismatch') {
              if (candidates.indexOf(el) === -1) candidates.push(el);
            }
          }
          // Prefer strong-id lookups. If id / testId is present and yields a
          // unique element, that's our hit.
          try {
            if (fp.id) {
              const byId = document.getElementById(fp.id);
              if (byId) tryAdd(byId);
            }
            if (fp.testId) {
              const byTestIdA = document.querySelectorAll('[data-testid="' + fp.testId.replace(/"/g, '\\\\"') + '"]');
              for (let i = 0; i < byTestIdA.length; i++) tryAdd(byTestIdA[i]);
              const byTestIdB = document.querySelectorAll('[data-test="' + fp.testId.replace(/"/g, '\\\\"') + '"]');
              for (let i = 0; i < byTestIdB.length; i++) tryAdd(byTestIdB[i]);
            }
            // aria-label is only a useful shortlist when nothing stronger is set
            if (candidates.length === 0 && fp.ariaLabel) {
              const byAria = document.querySelectorAll('[aria-label="' + fp.ariaLabel.replace(/"/g, '\\\\"') + '"]');
              for (let i = 0; i < byAria.length; i++) tryAdd(byAria[i]);
            }
          } catch (_) { /* bad selectors from weird fp values — skip */ }
          return candidates.length === 1 ? candidates[0] : null;
        }

        const fp = identity[ref];
        let el = document.querySelector('[data-opencli-ref="' + ref + '"]');
        if (!el) el = document.querySelector('[data-ref="' + ref + '"]');

        // If the ref tag is gone from the DOM, last-chance reidentify.
        if (!el) {
          const recovered = reidentify(fp);
          if (recovered) {
            try {
              recovered.setAttribute('data-opencli-ref', ref);
              identity[ref] = fingerprintOf(recovered);
            } catch (_) {}
            window.__resolved = recovered;
            return { ok: true, matches_n: 1, match_level: 'reidentified' };
          }
          return {
            ok: false,
            code: 'not_found',
            message: 'ref=' + ref + ' not found in DOM',
            hint: 'The element may have been removed. Re-run \`opencli browser state\` to get a fresh snapshot.',
          };
        }

        // No stored fingerprint (older page / unknown ref) — accept as exact.
        if (!fp) {
          window.__resolved = el;
          return { ok: true, matches_n: 1, match_level: 'exact' };
        }

        const liveFp = fingerprintOf(el);
        const level = classifyMatch(fp, liveFp);

        if (level === 'exact' || level === 'stable') {
          window.__resolved = el;
          return { ok: true, matches_n: 1, match_level: level };
        }

        // Tag / strong-id mismatch — try to find the real element elsewhere
        // before giving up. Covers e.g. a modal re-mount that discarded the
        // data-opencli-ref attribute on the surviving node.
        const recovered = reidentify(fp);
        if (recovered && recovered !== el) {
          try {
            el.removeAttribute('data-opencli-ref');
            recovered.setAttribute('data-opencli-ref', ref);
            identity[ref] = fingerprintOf(recovered);
          } catch (_) {}
          window.__resolved = recovered;
          return { ok: true, matches_n: 1, match_level: 'reidentified' };
        }

        return {
          ok: false,
          code: 'stale_ref',
          message: 'ref=' + ref + ' was <' + fp.tag + '>' + (fp.text ? '"' + fp.text + '"' : '')
            + ' but now points to <' + liveFp.tag + '>' + (liveFp.text ? '"' + liveFp.text.slice(0, 30) + '"' : ''),
          hint: 'The page has changed since the last snapshot. Re-run \`opencli browser state\` to refresh.',
        };
      }

      // ── CSS selector path (any non-numeric input) ──
      {
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
          return { ok: true, matches_n: matches.length, match_level: 'exact' };
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
        return { ok: true, matches_n: matches.length, match_level: 'exact' };
      }
    })()
  `;
}

/**
 * Generate JS that scrolls + measures `__resolved` without clicking.
 *
 * Generic click prefers CDP `Input.dispatchMouseEvent`, which fires the full
 * pointer/mouse chain that Radix/MUI/shadcn dropdowns rely on. Keep measurement
 * separate so the CDP-primary path does not call DOM `el.click()` first.
 */
export function boundingRectResolvedJs(opts: { skipScroll?: boolean } = {}): string {
  const shouldScroll = opts.skipScroll ? 'false' : 'true';
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      if (${shouldScroll}) el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const visible = w > 0 && h > 0;
      return { x, y, w, h, visible };
    })()
  `;
}

/**
 * Generate JS for click that uses the unified resolver.
 * Assumes resolveTargetJs has been called and __resolved is set.
 *
 * This is the JS fallback path. BasePage.click uses boundingRectResolvedJs for
 * the CDP-primary path and only reaches this when native click is unavailable
 * or the target has no usable rect.
 */
export function clickResolvedJs(opts: { skipScroll?: boolean } = {}): string {
  const shouldScroll = opts.skipScroll ? 'false' : 'true';
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      if (${shouldScroll}) el.scrollIntoView({ behavior: 'instant', block: 'center' });
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

export type FillResolvedResult =
  | { ok: true; actual: string; expected: string; length: number; mode: 'input' | 'textarea' | 'contenteditable' }
  | { ok: false; actual: string; expected: string; length: number; mode: 'input' | 'textarea' | 'contenteditable' }
  | { ok: false; reason: string; tag?: string; type?: string; role?: string };

/**
 * Prepare the resolved element for native CDP Input.insertText.
 *
 * This preserves `browser type`'s existing "replace current text" semantics:
 * focus the editable target, select its current contents, then let CDP insert
 * real browser text input so rich editors can update their internal state.
 */
export function prepareNativeTypeResolvedJs(opts: { skipScroll?: boolean; skipFocus?: boolean } = {}): string {
  const shouldScroll = opts.skipScroll ? 'false' : 'true';
  const shouldFocus = opts.skipFocus ? 'false' : 'true';
  return `
    (() => {
      const original = window.__resolved;
      if (!original) throw new Error('No resolved element');

      function nearestContentEditableHost(el) {
        let current = el;
        while (current && current.nodeType === 1) {
          if (current.hasAttribute && current.hasAttribute('contenteditable')) return current;
          current = current.parentElement;
        }
        return el.isContentEditable ? el : null;
      }

      const editableHost = original.isContentEditable ? nearestContentEditableHost(original) : null;
      const inputTypes = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'password']);
      const isInput = original instanceof HTMLInputElement;
      const isTextarea = original instanceof HTMLTextAreaElement;
      const isTextControl = isTextarea || (isInput && inputTypes.has((original.getAttribute('type') || original.type || '').toLowerCase()));
      const el = editableHost || (isTextControl ? original : null);

      if (!el) {
        return {
          ok: false,
          reason: 'not_editable',
          tag: original.tagName ? original.tagName.toLowerCase() : '',
        };
      }

      window.__resolved = el;
      if (${shouldScroll}) el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      if (${shouldFocus}) {
        try {
          el.focus({ preventScroll: true });
        } catch (_) {
          el.focus();
        }
      }

      if (editableHost) {
        const sel = window.getSelection();
        if (!sel) return { ok: false, reason: 'selection_unavailable', mode: 'contenteditable' };
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        return { ok: true, mode: 'contenteditable' };
      }

      let selected = false;
      try {
        if (typeof el.setSelectionRange === 'function') {
          el.setSelectionRange(0, String(el.value || '').length);
          selected = true;
        }
      } catch (_) {}
      try {
        if (!selected && typeof el.select === 'function') {
          el.select();
          selected = true;
        }
      } catch (_) {}

      return selected
        ? { ok: true, mode: isTextarea ? 'textarea' : 'input' }
        : { ok: false, reason: 'selection_unavailable', mode: isTextarea ? 'textarea' : 'input' };
    })()
  `;
}

/**
 * Verify the exact value/text currently held by the resolved editable target.
 * Assumes resolveTargetJs and prepareNativeTypeResolvedJs have already set
 * `window.__resolved` to the normalized editable host.
 */
export function verifyFilledResolvedJs(expected: string): string {
  const safeText = JSON.stringify(expected);
  return `
    (() => {
      const el = window.__resolved;
      if (!el) return { ok: false, reason: 'no_resolved_element' };

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      const isInput = el instanceof HTMLInputElement;
      const isTextarea = el instanceof HTMLTextAreaElement;
      const mode = el.isContentEditable
        ? 'contenteditable'
        : isTextarea
          ? 'textarea'
          : isInput
            ? 'input'
            : '';

      if (!mode) {
        return {
          ok: false,
          reason: 'not_editable',
          tag,
          role: el.getAttribute ? (el.getAttribute('role') || '') : '',
        };
      }

      const actual = mode === 'contenteditable' ? (el.innerText || '') : String(el.value || '');
      return {
        ok: actual === ${safeText},
        actual,
        expected: ${safeText},
        length: actual.length,
        mode,
      };
    })()
  `;
}

/**
 * Generate JS for scrollTo that uses the unified resolver.
 * Assumes resolveTargetJs has been called and __resolved is set.
 */
export function scrollResolvedJs(opts: { skipScroll?: boolean } = {}): string {
  const shouldScroll = opts.skipScroll ? 'false' : 'true';
  return `
    (() => {
      const el = window.__resolved;
      if (!el) throw new Error('No resolved element');
      if (${shouldScroll}) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
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
