import { describe, it, expect } from 'vitest';
import { cdpKeyPressEvents } from './key-definitions.js';

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

  it('treats Return as Enter', () => {
    expect(cdpKeyPressEvents('Return')).toEqual(cdpKeyPressEvents('Enter'));
  });

  it('maps navigation keys without text', () => {
    expect(cdpKeyPressEvents('Tab').keyDown).toEqual({
      type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0,
    });
    expect(cdpKeyPressEvents('Escape').keyDown).toMatchObject({ code: 'Escape', windowsVirtualKeyCode: 27 });
    expect(cdpKeyPressEvents('ArrowDown').keyDown).toMatchObject({ code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    expect(cdpKeyPressEvents('F5').keyDown).toMatchObject({ code: 'F5', windowsVirtualKeyCode: 116 });
    expect(cdpKeyPressEvents('Backspace').keyDown).not.toHaveProperty('text');
  });

  it('maps Space to the DOM key value with text', () => {
    expect(cdpKeyPressEvents('Space').keyDown).toMatchObject({
      key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ',
    });
  });

  it('maps letters and digits to KeyX / DigitN with text', () => {
    expect(cdpKeyPressEvents('a').keyDown).toMatchObject({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' });
    expect(cdpKeyPressEvents('Z').keyDown).toMatchObject({ key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: 'Z' });
    expect(cdpKeyPressEvents('7').keyDown).toMatchObject({ key: '7', code: 'Digit7', windowsVirtualKeyCode: 55, text: '7' });
  });

  it('drops text for Ctrl/Alt/Meta chords but keeps it for Shift', () => {
    expect(cdpKeyPressEvents('a', 2).keyDown).not.toHaveProperty('text');
    expect(cdpKeyPressEvents('Enter', 4).keyDown).not.toHaveProperty('text');
    expect(cdpKeyPressEvents('A', 8).keyDown).toMatchObject({ text: 'A', modifiers: 8 });
  });

  it('keeps unknown key names as key-only events', () => {
    expect(cdpKeyPressEvents('MediaPlayPause')).toEqual({
      keyDown: { type: 'keyDown', key: 'MediaPlayPause', modifiers: 0 },
      keyUp: { type: 'keyUp', key: 'MediaPlayPause', modifiers: 0 },
    });
    expect(cdpKeyPressEvents('/').keyDown).toEqual({ type: 'keyDown', key: '/', modifiers: 0, text: '/', unmodifiedText: '/' });
  });
});
