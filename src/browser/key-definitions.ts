/**
 * Key metadata for CDP `Input.dispatchKeyEvent`.
 *
 * CDP does not derive `code` / `keyCode` from `key`, and it only emits a
 * `keypress` when `text` is set. Without these fields pages that check
 * `event.keyCode === 13` (or listen for `keypress`) ignore native key presses.
 * Values follow the US keyboard layout used by Chrome DevTools / Puppeteer.
 */

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

for (let n = 1; n <= 12; n++) {
  NAMED_KEYS[`F${n}`] = { key: `F${n}`, code: `F${n}`, keyCode: 111 + n };
}

const ALIASES: Record<string, string> = {
  Return: 'Enter',
  Esc: 'Escape',
  ' ': 'Space',
};

function lookupKey(key: string): KeyDefinition | undefined {
  const named = NAMED_KEYS[ALIASES[key] ?? key];
  if (named) return named;

  if (/^[a-z]$/i.test(key)) {
    const upper = key.toUpperCase();
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
  }
  if (/^[0-9]$/.test(key)) {
    return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  }
  return undefined;
}

/** Bit flags used by CDP `modifiers`: Alt=1, Ctrl=2, Meta=4, Shift=8. */
const NON_SHIFT_MODIFIERS = 1 | 2 | 4;

/**
 * Build the keyDown / keyUp `Input.dispatchKeyEvent` params for one key press.
 * Unknown key names fall back to sending `key` alone.
 */
export function cdpKeyPressEvents(key: string, modifiers = 0): {
  keyDown: Record<string, unknown>;
  keyUp: Record<string, unknown>;
} {
  const def = lookupKey(key);
  const fields = {
    key: def?.key ?? key,
    ...(def ? { code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode } : {}),
    modifiers,
  };
  // Single printable characters without a layout entry still get `text`
  // so Chrome emits keypress/input for them.
  const text = def?.text ?? ([...key].length === 1 ? key : undefined);
  // Shortcut chords (Ctrl/Alt/Meta + key) must not insert characters.
  const withText = text !== undefined && (modifiers & NON_SHIFT_MODIFIERS) === 0;
  return {
    keyDown: { type: 'keyDown', ...fields, ...(withText ? { text, unmodifiedText: text } : {}) },
    keyUp: { type: 'keyUp', ...fields },
  };
}
