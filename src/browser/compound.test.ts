import { describe, expect, it } from 'vitest';
import {
  COMPOUND_INFO_JS,
  COMPOUND_LABEL_CAP,
  COMPOUND_SELECT_OPTIONS_CAP,
  type CompoundInfo,
} from './compound.js';

/**
 * Tests run the JS source in a sandbox via `new Function`, feeding it
 * minimal mock elements shaped like the DOM elements the real code sees
 * at runtime. Avoids a full jsdom setup while still exercising the logic
 * end-to-end instead of only snapshotting string markers.
 */
function runCompound(mockEl: unknown): CompoundInfo | null {
  const fn = new Function('el', `${COMPOUND_INFO_JS}\nreturn compoundInfoOf(el);`);
  return fn(mockEl) as CompoundInfo | null;
}

function mockInput(attrs: Record<string, string | undefined>, extras: Partial<{ value: string; multiple: boolean; files: { name: string }[] }> = {}) {
  return {
    tagName: 'INPUT',
    value: extras.value,
    multiple: extras.multiple,
    files: extras.files,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

function mockSelect(options: { value: string; label?: string; text?: string; selected?: boolean; disabled?: boolean }[], multiple = false) {
  const opts = options.map(o => ({ ...o, selected: !!o.selected }));
  return {
    tagName: 'SELECT',
    multiple,
    options: opts,
    getAttribute: () => null,
  };
}

describe('compoundInfoOf — date-like inputs', () => {
  it('returns { control, format, current } for <input type=date>', () => {
    const info = runCompound(mockInput({ type: 'date' }, { value: '2026-04-21' }));
    expect(info).toEqual({ control: 'date', format: 'YYYY-MM-DD', current: '2026-04-21' });
  });

  it('surfaces min + max when present', () => {
    const info = runCompound(mockInput({ type: 'date', min: '2026-01-01', max: '2026-12-31' }, { value: '2026-04-21' }));
    expect(info).toMatchObject({ min: '2026-01-01', max: '2026-12-31' });
  });

  it('handles time / datetime-local / month / week with correct format strings', () => {
    const formats: Record<string, string> = {
      time: 'HH:MM',
      'datetime-local': 'YYYY-MM-DDTHH:MM',
      month: 'YYYY-MM',
      week: 'YYYY-W##',
    };
    for (const [type, fmt] of Object.entries(formats)) {
      const info = runCompound(mockInput({ type }, { value: '' })) as { format: string };
      expect(info.format).toBe(fmt);
    }
  });

  it('coerces null value into empty string instead of crashing', () => {
    const info = runCompound(mockInput({ type: 'date' }));
    expect(info).toMatchObject({ control: 'date', current: '' });
  });
});

describe('compoundInfoOf — file inputs', () => {
  it('returns { control: file, multiple, current[] }', () => {
    const info = runCompound(mockInput({ type: 'file' }, {
      multiple: true,
      files: [{ name: 'a.png' }, { name: 'b.jpg' }],
    }));
    expect(info).toEqual({ control: 'file', multiple: true, current: ['a.png', 'b.jpg'] });
  });

  it('includes accept when present', () => {
    const info = runCompound(mockInput({ type: 'file', accept: 'image/*' }, { multiple: false }));
    expect(info).toMatchObject({ control: 'file', accept: 'image/*' });
  });

  it('returns empty current[] when nothing uploaded', () => {
    const info = runCompound(mockInput({ type: 'file' }, { multiple: false }));
    expect(info).toEqual({ control: 'file', multiple: false, current: [] });
  });

  it('caps file name at COMPOUND_LABEL_CAP', () => {
    const longName = 'x'.repeat(COMPOUND_LABEL_CAP + 50);
    const info = runCompound(mockInput({ type: 'file' }, { multiple: false, files: [{ name: longName }] })) as { current: string[] };
    expect(info.current[0]!.length).toBe(COMPOUND_LABEL_CAP);
  });
});

describe('compoundInfoOf — select', () => {
  it('returns full options list with labels, values, selected flag', () => {
    const info = runCompound(mockSelect([
      { value: 'us', label: 'United States', selected: true },
      { value: 'ca', label: 'Canada' },
      { value: 'fr', label: 'France' },
    ])) as { options: Array<{ label: string; value: string; selected: boolean }> };
    expect(info.options).toHaveLength(3);
    expect(info.options[0]).toEqual({ label: 'United States', value: 'us', selected: true });
    expect(info.options[2]).toEqual({ label: 'France', value: 'fr', selected: false });
  });

  it('sets current to the selected label (single-select)', () => {
    const info = runCompound(mockSelect([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Bravo', selected: true },
    ]));
    expect(info).toMatchObject({ control: 'select', multiple: false, current: 'Bravo' });
  });

  it('sets current to an array of labels when multiple=true', () => {
    const info = runCompound(mockSelect([
      { value: 'a', label: 'Alpha', selected: true },
      { value: 'b', label: 'Bravo' },
      { value: 'c', label: 'Charlie', selected: true },
    ], true));
    expect(info).toMatchObject({ control: 'select', multiple: true, current: ['Alpha', 'Charlie'] });
  });

  it('falls back from option.label to option.text', () => {
    const info = runCompound(mockSelect([
      { value: 'a', text: 'FromText' },
      { value: 'b', label: '', text: 'EmptyLabelFallback' },
    ])) as { options: Array<{ label: string }> };
    expect(info.options[0]!.label).toBe('FromText');
    expect(info.options[1]!.label).toBe('EmptyLabelFallback');
  });

  it('marks disabled options', () => {
    const info = runCompound(mockSelect([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
    ])) as { options: Array<{ disabled?: boolean }> };
    expect(info.options[0]!.disabled).toBeUndefined();
    expect(info.options[1]!.disabled).toBe(true);
  });

  it('caps options[] at COMPOUND_SELECT_OPTIONS_CAP but keeps true options_total', () => {
    const big = Array.from({ length: COMPOUND_SELECT_OPTIONS_CAP + 25 }, (_, i) => ({
      value: 'v' + i,
      label: 'L' + i,
    }));
    const info = runCompound(mockSelect(big)) as { options: unknown[]; options_total: number };
    expect(info.options.length).toBe(COMPOUND_SELECT_OPTIONS_CAP);
    expect(info.options_total).toBe(COMPOUND_SELECT_OPTIONS_CAP + 25);
  });

  it('returns "" for current on single-select with no selected option', () => {
    const info = runCompound(mockSelect([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]));
    expect(info).toMatchObject({ current: '' });
  });

  // Regression: the previous loop stopped walking options once it hit
  // COMPOUND_SELECT_OPTIONS_CAP, so a long country dropdown with the
  // selected country sitting at index 80 would be reported with current="".
  // Agents then thought nothing was selected and picked another country.
  it('populates current even when the selected option sits past the serialization cap', () => {
    const big = Array.from({ length: COMPOUND_SELECT_OPTIONS_CAP + 25 }, (_, i) => ({
      value: 'v' + i,
      label: 'L' + i,
      selected: i === COMPOUND_SELECT_OPTIONS_CAP + 10,
    }));
    const info = runCompound(mockSelect(big)) as { current: string; options: unknown[]; options_total: number };
    expect(info.current).toBe('L' + (COMPOUND_SELECT_OPTIONS_CAP + 10));
    expect(info.options.length).toBe(COMPOUND_SELECT_OPTIONS_CAP);
    expect(info.options_total).toBe(COMPOUND_SELECT_OPTIONS_CAP + 25);
  });

  it('multi-select: current[] includes labels for selected options beyond the cap', () => {
    const big = Array.from({ length: COMPOUND_SELECT_OPTIONS_CAP + 10 }, (_, i) => ({
      value: 'v' + i,
      label: 'L' + i,
      selected: i === 3 || i === COMPOUND_SELECT_OPTIONS_CAP + 5,
    }));
    const info = runCompound(mockSelect(big, true)) as { current: string[] };
    expect(info.current).toEqual(['L3', 'L' + (COMPOUND_SELECT_OPTIONS_CAP + 5)]);
  });
});

describe('compoundInfoOf — unsupported shapes', () => {
  it('returns null for plain text input', () => {
    expect(runCompound(mockInput({ type: 'text' }, { value: 'hi' }))).toBeNull();
  });

  it('returns null for non-form tags', () => {
    expect(runCompound({ tagName: 'DIV', getAttribute: () => null })).toBeNull();
  });

  it('returns null for null / missing element', () => {
    expect(runCompound(null)).toBeNull();
    expect(runCompound({} as unknown)).toBeNull();
  });
});
