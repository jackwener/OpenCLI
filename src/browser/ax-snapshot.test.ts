import { describe, expect, it } from 'vitest';
import { buildAxSnapshot, findAxRefReplacement } from './ax-snapshot.js';

describe('AX snapshot prototype', () => {
  it('builds compact refs from Accessibility.getFullAXTree output', () => {
    const result = buildAxSnapshot({
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2', '3'] },
        { nodeId: '2', role: { value: 'heading' }, name: { value: 'Expenses' }, backendDOMNodeId: 20 },
        {
          nodeId: '3',
          role: { value: 'combobox' },
          name: { value: 'Category' },
          backendDOMNodeId: 30,
          properties: [{ name: 'expanded', value: { value: false } }],
        },
      ],
    });

    expect(result.text).toContain('source: ax');
    expect(result.text).toContain('[1]heading "Expenses"');
    expect(result.text).toContain('[2]combobox "Category" expanded=false');
    expect(result.refs.get('2')).toEqual({
      ref: '2',
      backendNodeId: 30,
      role: 'combobox',
      name: 'Category',
    });
  });

  it('tracks nth only for duplicate role/name pairs', () => {
    const result = buildAxSnapshot({
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 10 },
        { nodeId: '3', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 11 },
      ],
    });

    expect(result.refs.get('1')).toMatchObject({ role: 'button', name: 'Save', nth: 0 });
    expect(result.refs.get('2')).toMatchObject({ role: 'button', name: 'Save', nth: 1 });
  });

  it('finds stale ref replacements by role/name/nth', () => {
    const replacement = findAxRefReplacement({
      nodes: [
        { nodeId: '1', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 10 },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 42 },
      ],
    }, {
      ref: '2',
      role: 'button',
      name: 'Save',
      backendNodeId: 11,
      nth: 1,
    });

    expect(replacement).toMatchObject({ ref: '2', backendNodeId: 42, role: 'button', name: 'Save', nth: 1 });
  });
});
