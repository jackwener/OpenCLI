import { describe, it, expect } from 'vitest';
import { cdpKeyPressEvents, describeKey, keyModifierFlags } from './key-definitions.js';

describe('cdpKeyPressEvents', () => {
  it('gives Enter keyCode 13, code and keypress text on keyDown only', () => {
    const { keyDown, keyUp } = cdpKeyPressEvents('Enter');
    expect(keyDown).toEqual({
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      modifiers: 0, text: '\r', unmodifiedText: '\r',
    });
    expect(keyUp).toEqual({
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0,
    });
  });

  it('treats Return and lower-case names as the canonical key', () => {
    expect(cdpKeyPressEvents('Return')).toEqual(cdpKeyPressEvents('Enter'));
    expect(cdpKeyPressEvents('enter')).toEqual(cdpKeyPressEvents('Enter'));
    expect(cdpKeyPressEvents('esc')).toEqual(cdpKeyPressEvents('Escape'));
    expect(cdpKeyPressEvents('pagedown')).toEqual(cdpKeyPressEvents('PageDown'));
  });

  it('sends keys without text as rawKeyDown so no keypress fires', () => {
    expect(cdpKeyPressEvents('Tab').keyDown).toEqual({
      type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0,
    });
    expect(cdpKeyPressEvents('Escape').keyDown).toMatchObject({ type: 'rawKeyDown', code: 'Escape', windowsVirtualKeyCode: 27 });
    expect(cdpKeyPressEvents('ArrowDown').keyDown).toMatchObject({ code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    expect(cdpKeyPressEvents('F5').keyDown).toMatchObject({ code: 'F5', windowsVirtualKeyCode: 116 });
    expect(cdpKeyPressEvents('Backspace').keyDown).not.toHaveProperty('text');
  });

  it('keeps unknown key names as key-only events', () => {
    expect(cdpKeyPressEvents('MediaPlayPause')).toEqual({
      keyDown: { type: 'rawKeyDown', key: 'MediaPlayPause', modifiers: 0 },
      keyUp: { type: 'keyUp', key: 'MediaPlayPause', modifiers: 0 },
    });
    expect(cdpKeyPressEvents('中').keyDown).toEqual({ type: 'keyDown', key: '中', modifiers: 0, text: '中', unmodifiedText: '中' });
  });
});

describe('describeKey', () => {
  it('maps Space to the DOM key value with text', () => {
    expect(describeKey('Space')).toEqual({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
    expect(describeKey(' ')).toEqual(describeKey('Space'));
  });

  it('maps letters, digits and punctuation to their physical key', () => {
    expect(describeKey('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' });
    expect(describeKey('Z')).toEqual({ key: 'Z', code: 'KeyZ', keyCode: 90, text: 'Z' });
    expect(describeKey('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55, text: '7' });
    expect(describeKey('/')).toEqual({ key: '/', code: 'Slash', keyCode: 191, text: '/' });
    expect(describeKey('?')).toEqual({ key: '?', code: 'Slash', keyCode: 191, text: '?' });
    expect(describeKey('KeyQ')).toEqual({ key: 'q', code: 'KeyQ', keyCode: 81, text: 'q' });
  });

  it('applies Shift to keys with a shifted value', () => {
    expect(describeKey('a', 8)).toEqual({ key: 'A', code: 'KeyA', keyCode: 65, text: 'A' });
    expect(describeKey('1', 8)).toEqual({ key: '!', code: 'Digit1', keyCode: 49, text: '!' });
    expect(describeKey('Tab', 8)).toEqual({ key: 'Tab', code: 'Tab', keyCode: 9 });
  });

  it('describes modifier keys themselves with their left location', () => {
    expect(describeKey('Control')).toEqual({ key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 });
    expect(describeKey('Cmd')).toEqual({ key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 });
  });

  it('drops text for Ctrl/Alt/Meta chords but keeps it for Shift', () => {
    expect(describeKey('a', 2)).not.toHaveProperty('text');
    expect(describeKey('Enter', 4)).not.toHaveProperty('text');
    expect(describeKey('a', 1)).not.toHaveProperty('text');
  });
});

describe('keyModifierFlags', () => {
  it('maps modifier names to CDP bit flags', () => {
    expect(keyModifierFlags(['Alt', 'Ctrl', 'Meta', 'Shift'])).toBe(15);
    expect(keyModifierFlags(['Control'])).toBe(2);
    expect(keyModifierFlags([])).toBe(0);
  });
});
