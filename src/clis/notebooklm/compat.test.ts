import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './bind-current.js';
import './get.js';
import './note-list.js';

describe('notebooklm compatibility aliases', () => {
  it('registers use as a compatibility alias for bind-current', () => {
    expect(getRegistry().get('notebooklm/use')).toBe(getRegistry().get('notebooklm/bind-current'));
  });

  it('registers metadata as a compatibility alias for get', () => {
    expect(getRegistry().get('notebooklm/metadata')).toBe(getRegistry().get('notebooklm/get'));
  });

  it('registers notes-list as a compatibility alias for note-list', () => {
    expect(getRegistry().get('notebooklm/notes-list')).toBe(getRegistry().get('notebooklm/note-list'));
  });
});
