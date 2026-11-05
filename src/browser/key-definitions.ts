/**
 * US keyboard layout for key presses (#2751).
 *
 * CDP `Input.dispatchKeyEvent` does not derive `code` / `keyCode` from `key`,
 * and Chrome only emits `keypress` (and runs Enter's implicit form submission
 * or newline insertion) when `text` is set. Every key press path — native CDP
 * and the synthetic DOM fallback — resolves its key through this one table so
 * pages see the same fields a physical key press produces. Values follow the
 * layout Chrome DevTools / Puppeteer (`USKeyboardLayout`) use.
 */

interface LayoutEntry {
  code: string;
  keyCode: number;
  key: string;
  /** `key` (and text) produced while Shift is held, when it differs. */
  shiftKey?: string;
  /** Text for keys whose text differs from `key` (Enter → "\r"). */
  text?: string;
  /** DOM KeyboardEvent.location; 1 = left modifier. */
  location?: number;
}

export interface KeyDescription {
  key: string;
  code?: string;
  keyCode?: number;
  text?: string;
  location?: number;
}

/** CDP `modifiers` bit flags. */
export const KEY_MODIFIER_FLAGS = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 } as const;

const LAYOUT: LayoutEntry[] = [
  { code: 'Enter', keyCode: 13, key: 'Enter', text: '\r' },
  { code: 'Tab', keyCode: 9, key: 'Tab' },
  { code: 'Backspace', keyCode: 8, key: 'Backspace' },
  { code: 'Escape', keyCode: 27, key: 'Escape' },
  { code: 'Space', keyCode: 32, key: ' ' },
  { code: 'Delete', keyCode: 46, key: 'Delete' },
  { code: 'Insert', keyCode: 45, key: 'Insert' },
  { code: 'Home', keyCode: 36, key: 'Home' },
  { code: 'End', keyCode: 35, key: 'End' },
  { code: 'PageUp', keyCode: 33, key: 'PageUp' },
  { code: 'PageDown', keyCode: 34, key: 'PageDown' },
  { code: 'ArrowLeft', keyCode: 37, key: 'ArrowLeft' },
  { code: 'ArrowUp', keyCode: 38, key: 'ArrowUp' },
  { code: 'ArrowRight', keyCode: 39, key: 'ArrowRight' },
  { code: 'ArrowDown', keyCode: 40, key: 'ArrowDown' },
  { code: 'CapsLock', keyCode: 20, key: 'CapsLock' },
  { code: 'ContextMenu', keyCode: 93, key: 'ContextMenu' },
  { code: 'ShiftLeft', keyCode: 16, key: 'Shift', location: 1 },
  { code: 'ControlLeft', keyCode: 17, key: 'Control', location: 1 },
  { code: 'AltLeft', keyCode: 18, key: 'Alt', location: 1 },
  { code: 'MetaLeft', keyCode: 91, key: 'Meta', location: 1 },
  { code: 'Minus', keyCode: 189, key: '-', shiftKey: '_' },
  { code: 'Equal', keyCode: 187, key: '=', shiftKey: '+' },
  { code: 'BracketLeft', keyCode: 219, key: '[', shiftKey: '{' },
  { code: 'BracketRight', keyCode: 221, key: ']', shiftKey: '}' },
  { code: 'Backslash', keyCode: 220, key: '\\', shiftKey: '|' },
  { code: 'Semicolon', keyCode: 186, key: ';', shiftKey: ':' },
  { code: 'Quote', keyCode: 222, key: '\'', shiftKey: '"' },
  { code: 'Comma', keyCode: 188, key: ',', shiftKey: '<' },
  { code: 'Period', keyCode: 190, key: '.', shiftKey: '>' },
  { code: 'Slash', keyCode: 191, key: '/', shiftKey: '?' },
  { code: 'Backquote', keyCode: 192, key: '`', shiftKey: '~' },
];

for (let n = 1; n <= 12; n++) LAYOUT.push({ code: `F${n}`, keyCode: 111 + n, key: `F${n}` });
[...')!@#$%^&*('].forEach((shiftKey, n) => {
  LAYOUT.push({ code: `Digit${n}`, keyCode: 48 + n, key: String(n), shiftKey });
});
for (let c = 65; c <= 90; c++) {
  const upper = String.fromCharCode(c);
  LAYOUT.push({ code: `Key${upper}`, keyCode: c, key: upper.toLowerCase(), shiftKey: upper });
}

/** Lookup by `key` value, shifted `key` value, or `code`. */
const BY_NAME = new Map<string, { entry: LayoutEntry; shifted: boolean }>();
for (const entry of LAYOUT) {
  BY_NAME.set(entry.key, { entry, shifted: false });
  if (entry.shiftKey) BY_NAME.set(entry.shiftKey, { entry, shifted: true });
  if (!BY_NAME.has(entry.code)) BY_NAME.set(entry.code, { entry, shifted: false });
}

/** Common spellings agents and users type for named keys. */
const ALIASES: Record<string, string> = {
  return: 'Enter',
  esc: 'Escape',
  space: ' ',
  del: 'Delete',
  ctrl: 'Control',
  cmd: 'Meta',
  command: 'Meta',
  option: 'Alt',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** Named keys matched case-insensitively ("enter", "ESCAPE", "pagedown"). */
const BY_LOWER_NAME = new Map<string, string>();
for (const name of BY_NAME.keys()) {
  if (name.length > 1 && !BY_LOWER_NAME.has(name.toLowerCase())) BY_LOWER_NAME.set(name.toLowerCase(), name);
}

function lookup(name: string): { entry: LayoutEntry; shifted: boolean } | undefined {
  const exact = BY_NAME.get(name);
  if (exact) return exact;
  if (name.length <= 1) return undefined;
  const lower = name.toLowerCase();
  const canonical = ALIASES[lower] ?? BY_LOWER_NAME.get(lower);
  return canonical === undefined ? undefined : BY_NAME.get(canonical);
}

/**
 * Describe the key event a physical US-layout key press of `name` produces
 * under `modifiers` (CDP bit flags). Unknown names keep `key` as given; a
 * single unknown character (CJK, emoji, accented letters) still carries text.
 */
export function describeKey(name: string, modifiers = 0): KeyDescription {
  const found = lookup(name);
  let desc: KeyDescription;
  if (found) {
    const { entry } = found;
    const shifted = found.shifted || ((modifiers & KEY_MODIFIER_FLAGS.Shift) !== 0 && entry.shiftKey !== undefined);
    const key = shifted && entry.shiftKey ? entry.shiftKey : entry.key;
    desc = {
      key,
      code: entry.code,
      keyCode: entry.keyCode,
      text: entry.text ?? (key.length === 1 ? key : undefined),
      ...(entry.location ? { location: entry.location } : {}),
    };
  } else {
    desc = { key: name, text: [...name].length === 1 ? name : undefined };
  }
  // Shortcut chords (Ctrl/Alt/Meta + key) must not insert characters.
  if (modifiers & ~KEY_MODIFIER_FLAGS.Shift) desc.text = undefined;
  if (desc.text === undefined) delete desc.text;
  return desc;
}

/** Convert modifier names ("Ctrl", "Control", "Meta", "Alt", "Shift") to CDP flags. */
export function keyModifierFlags(modifiers: string[]): number {
  let flags = 0;
  for (const mod of modifiers) {
    if (mod === 'Alt') flags |= KEY_MODIFIER_FLAGS.Alt;
    if (mod === 'Ctrl' || mod === 'Control') flags |= KEY_MODIFIER_FLAGS.Ctrl;
    if (mod === 'Meta') flags |= KEY_MODIFIER_FLAGS.Meta;
    if (mod === 'Shift') flags |= KEY_MODIFIER_FLAGS.Shift;
  }
  return flags;
}

/**
 * Build the keyDown / keyUp `Input.dispatchKeyEvent` params for one key press.
 * Like Puppeteer, keys without text use `rawKeyDown`; keys with text use
 * `keyDown`, which makes Chrome emit the `keypress` phase.
 */
export function cdpKeyPressEvents(name: string, modifiers = 0): {
  keyDown: Record<string, unknown>;
  keyUp: Record<string, unknown>;
} {
  const desc = describeKey(name, modifiers);
  const fields: Record<string, unknown> = { key: desc.key };
  if (desc.code !== undefined) {
    fields.code = desc.code;
    fields.windowsVirtualKeyCode = desc.keyCode;
    fields.nativeVirtualKeyCode = desc.keyCode;
  }
  if (desc.location !== undefined) fields.location = desc.location;
  fields.modifiers = modifiers;
  return {
    keyDown: desc.text !== undefined
      ? { type: 'keyDown', ...fields, text: desc.text, unmodifiedText: desc.text }
      : { type: 'rawKeyDown', ...fields },
    keyUp: { type: 'keyUp', ...fields },
  };
}
