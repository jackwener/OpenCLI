/**
 * Shared DOM operation JS generators.
 *
 * Used by both Page (daemon mode) and CDPPage (direct CDP mode)
 * to eliminate code duplication for click, type, press, wait, scroll, etc.
 */

/** Shared element lookup JS fragment (4-strategy resolution) */
function resolveElementJs(safeRef: string, selectorSet: string): string {
  return `
      const ref = ${safeRef};
      let el = null;
      try { el = document.querySelector('[data-opencli-ref="' + ref + '"]'); } catch {}
      if (!el) {
        try { el = document.querySelector('[data-ref="' + ref + '"]'); } catch {}
      }
      if (!el && ref.match(/^[a-zA-Z#.\\[]/)) {
        try { el = document.querySelector(ref); } catch {}
      }
      if (!el) {
        const idx = parseInt(ref, 10);
        if (!isNaN(idx)) {
          el = document.querySelectorAll('${selectorSet}')[idx];
        }
      }`;
}

/** Generate JS to click an element by ref.
 *  Returns { status, x, y, w, h } for CDP fallback when JS click fails. */
export function clickJs(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `
    (() => {
      ${resolveElementJs(safeRef, 'a, button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')}
      if (!el) throw new Error('Element not found: ' + ref);
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

/** Generate JS to type text into an element by ref.
 *  Uses native setter for React compat + execCommand for contenteditable. */
export function typeTextJs(ref: string, text: string): string {
  const safeRef = JSON.stringify(ref);
  const safeText = JSON.stringify(text);
  return `
    (() => {
      ${resolveElementJs(safeRef, 'input, textarea, [contenteditable="true"]')}
      if (!el) throw new Error('Element not found: ' + ref);
      el.focus();
      if (el.isContentEditable) {
        // Select all content + delete, then insert (supports undo, works with rich text editors)
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, ${safeText});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Use native setter for React/framework compatibility (match element type)
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

/** Generate JS to press a keyboard key */
export function pressKeyJs(key: string): string {
  return `
    (() => {
      const el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
      return 'pressed';
    })()
  `;
}

/** Generate JS to wait for text to appear in the page */
export function waitForTextJs(text: string, timeoutMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${timeoutMs};
      const check = () => {
        if (document.body.innerText.includes(${JSON.stringify(text)})) return resolve('found');
        if (Date.now() > deadline) return reject(new Error('Text not found: ' + ${JSON.stringify(text)}));
        setTimeout(check, 200);
      };
      check();
    })
  `;
}

/** Generate JS for scroll */
export function scrollJs(direction: string, amount: number): string {
  const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  return `window.scrollBy(${dx}, ${dy})`;
}

/** Generate JS for auto-scroll with lazy-load detection */
export function autoScrollJs(times: number, delayMs: number): string {
  return `
    (async () => {
      if (!document.body) return;
      for (let i = 0; i < ${times}; i++) {
        const lastHeight = document.body.scrollHeight;
        window.scrollTo(0, lastHeight);
        await new Promise(resolve => {
          let timeoutId;
          const observer = new MutationObserver(() => {
            if (document.body.scrollHeight > lastHeight) {
              clearTimeout(timeoutId);
              observer.disconnect();
              setTimeout(resolve, 100);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          timeoutId = setTimeout(() => { observer.disconnect(); resolve(null); }, ${delayMs});
        });
      }
    })()
  `;
}

/** Generate JS to read performance resource entries as network requests */
export function networkRequestsJs(includeStatic: boolean): string {
  return `
    (() => {
      const entries = performance.getEntriesByType('resource');
      return entries
        ${includeStatic ? '' : '.filter(e => !["img", "font", "css", "script"].some(t => e.initiatorType === t))'}
        .map(e => ({
          url: e.name,
          type: e.initiatorType,
          duration: Math.round(e.duration),
          size: e.transferSize || 0,
        }));
    })()
  `;
}

/**
 * Generate JS to wait until the DOM stabilizes (no mutations for `quietMs`),
 * with a hard cap at `maxMs`. Uses MutationObserver in the browser.
 *
 * Returns as soon as the page stops changing, avoiding unnecessary fixed waits.
 * If document.body is not available, falls back to a fixed sleep of maxMs.
 */
export function waitForDomStableJs(maxMs: number, quietMs: number): string {
  return `
    new Promise(resolve => {
      if (!document.body) {
        setTimeout(() => resolve('nobody'), ${maxMs});
        return;
      }
      let timer = null;
      let cap = null;
      const done = (reason) => {
        clearTimeout(timer);
        clearTimeout(cap);
        obs.disconnect();
        resolve(reason);
      };
      const resetQuiet = () => {
        clearTimeout(timer);
        timer = setTimeout(() => done('quiet'), ${quietMs});
      };
      const obs = new MutationObserver(resetQuiet);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      resetQuiet();
      cap = setTimeout(() => done('capped'), ${maxMs});
    })
  `;
}

/**
 * Generate JS to wait until window.__opencli_xhr has ≥1 captured response.
 * Polls every 100ms. Resolves 'captured' on success; rejects after maxMs.
 * Used after installInterceptor() + goto() instead of a fixed sleep.
 */
export function waitForCaptureJs(maxMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${maxMs};
      const check = () => {
        if ((window.__opencli_xhr || []).length > 0) return resolve('captured');
        if (Date.now() > deadline) return reject(new Error('No network capture within ${maxMs / 1000}s'));
        setTimeout(check, 100);
      };
      check();
    })
  `;
}

/**
 * Generate JS to wait until document.querySelector(selector) returns a match.
 * Uses MutationObserver for near-instant resolution; falls back to reject after timeoutMs.
 */
export function waitForSelectorJs(selector: string, timeoutMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const sel = ${JSON.stringify(selector)};
      if (document.querySelector(sel)) return resolve('found');
      const cap = setTimeout(() => {
        obs.disconnect();
        reject(new Error('Selector not found: ' + sel));
      }, ${timeoutMs});
      const obs = new MutationObserver(() => {
        if (document.querySelector(sel)) {
          clearTimeout(cap);
          obs.disconnect();
          resolve('found');
        }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    })
  `;
}
