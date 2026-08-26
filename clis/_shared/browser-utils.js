/**
 * Shared browser‑page utilities for DOM‑extraction adapters.
 *
 * These helpers centralise the JSON‑serialisation / safe‑parse round‑trip
 * needed when talking to a page context via `page.evaluate`.
 */

// ---------------------------------------------------------------------------
// Type guards / shape normalisers
// ---------------------------------------------------------------------------

/**
 * Check if a value is a plain record (object, not null, not array).
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse a JSON string, returning `fallback` on any parse failure.
 *
 * @template T
 * @param {unknown} raw
 * @param {T} fallback
 * @returns {T}
 */
export function parseJsonOrDefault(raw, fallback) {
  try {
    return /** @type {T} */ (JSON.parse(String(raw ?? '')));
  } catch {
    return fallback;
  }
}

/**
 * Evaluate a function body in the browser and parse its JSON result.
 *
 * The `functionBody` must be valid inside `(() => { ... })()` — i.e. zero or
 * more statements ending with a `return` expression.
 *
 * @template T
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {string} functionBody
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export async function evaluateJson(page, functionBody, fallback) {
  const raw = await page.evaluate(`
    JSON.stringify((() => {
      ${functionBody}
    })())
  `);

  return parseJsonOrDefault(raw, fallback);
}

/**
 * Normalise an unknown value into a known‑shape string record.
 *
 * Fields not present on the source are filled from `defaults`.
 *
 * @template {Record<string, string>} T
 * @param {unknown} value
 * @param {T} defaults
 * @returns {T}
 */
export function normalizeStringRecord(value, defaults) {
  if (!isRecord(value)) return { ...defaults };

  return /** @type {T} */ (Object.fromEntries(
    Object.keys(defaults).map((key) => [key, String(value[key] || '')])
  ));
}

// ---------------------------------------------------------------------------
// Desktop / Electron helpers
// ---------------------------------------------------------------------------

/**
 * Submit text into a search input field, with Cmd/Ctrl+F fallback.
 *
 * Tries native input‑value setter + `input` event first (works on most
 * Electron renderers), then falls back to keyboard shortcut + typeText.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {object} options
 * @param {string} options.query
 * @param {string} options.inputSelector
 * @param {number} [options.settleSeconds]
 * @returns {Promise<void>}
 */
export async function submitSearchQuery(page, {
  query,
  inputSelector,
  settleSeconds = 3,
}) {
  const inputFocused = await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(inputSelector)});
      if (!input) return false;

      input.focus();

      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      );
      if (!descriptor?.set) return false;

      descriptor.set.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);

  if (!inputFocused) {
    // Fallback: use keyboard shortcut + insertText.
    // NOTE: page.typeText(ref, text) uses ref as a CSS selector — don't pass query as ref!
    const findShortcut = process.platform === 'darwin' ? 'Meta+F' : 'Control+F';
    await page.pressKey(findShortcut);
    await page.wait(0.5);
    // Use insertText (types via CDP Input.insertText, no CSS selector needed)
    // Falls back to pressing individual keys if insertText is unavailable.
    if (typeof page.insertText === 'function') {
      await page.insertText(query);
    } else {
      // Last resort: type each character via keyboard events
      for (const ch of query) {
        await page.pressKey(ch);
      }
    }
  }

  await page.pressKey('Enter');
  await page.wait({ time: settleSeconds });
}
