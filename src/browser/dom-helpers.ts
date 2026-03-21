/**
 * Shared DOM operation JS generators.
 *
 * Used by both Page (daemon mode) and CDPPage (direct CDP mode)
 * to eliminate code duplication for click, type, press, wait, scroll, etc.
 */

/** Generate JS to click an element by ref */
export function clickJs(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `
    (() => {
      const ref = ${safeRef};
      // 1. data-opencli-ref (set by snapshot engine)
      let el = document.querySelector('[data-opencli-ref="' + ref + '"]');
      // 2. data-ref (legacy)
      if (!el) el = document.querySelector('[data-ref="' + ref + '"]');
      // 3. CSS selector
      if (!el && ref.match(/^[a-zA-Z#.\\[]/)) {
        try { el = document.querySelector(ref); } catch {}
      }
      // 4. Numeric index into interactive elements
      if (!el) {
        const idx = parseInt(ref, 10);
        if (!isNaN(idx)) {
          el = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')[idx];
        }
      }
      if (!el) throw new Error('Element not found: ' + ref);
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.click();
      return 'clicked';
    })()
  `;
}

/** Generate JS to type text into an element by ref */
export function typeTextJs(ref: string, text: string): string {
  const safeRef = JSON.stringify(ref);
  const safeText = JSON.stringify(text);
  return `
    (() => {
      const ref = ${safeRef};
      // 1. data-opencli-ref (set by snapshot engine)
      let el = document.querySelector('[data-opencli-ref="' + ref + '"]');
      // 2. data-ref (legacy)
      if (!el) el = document.querySelector('[data-ref="' + ref + '"]');
      // 3. CSS selector
      if (!el && ref.match(/^[a-zA-Z#.\\[]/)) {
        try { el = document.querySelector(ref); } catch {}
      }
      // 4. Numeric index into typeable elements
      if (!el) {
        const idx = parseInt(ref, 10);
        if (!isNaN(idx)) {
          el = document.querySelectorAll('input, textarea, [contenteditable="true"]')[idx];
        }
      }
      if (!el) throw new Error('Element not found: ' + ref);
      el.focus();
      if (el.isContentEditable) {
        el.textContent = ${safeText};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.value = ${safeText};
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
