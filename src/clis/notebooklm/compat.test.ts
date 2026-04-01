import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './bind-current.js';
import './get.js';
import './language-get.js';
import './language-list.js';
import './language-set.js';
import './note-list.js';
import './notes-get.js';
import './source-fulltext.js';
import './source-get.js';
import './source-guide.js';
import './source-list.js';

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

  it('remounts source commands onto nested canonical paths while keeping flat aliases', () => {
    expect(getRegistry().get('notebooklm/source/list')).toBe(getRegistry().get('notebooklm/source-list'));
    expect(getRegistry().get('notebooklm/source/get')).toBe(getRegistry().get('notebooklm/source-get'));
    expect(getRegistry().get('notebooklm/source/fulltext')).toBe(getRegistry().get('notebooklm/source-fulltext'));
    expect(getRegistry().get('notebooklm/source/guide')).toBe(getRegistry().get('notebooklm/source-guide'));
  });

  it('remounts note and language commands onto nested canonical paths while keeping flat aliases', () => {
    expect(getRegistry().get('notebooklm/notes/list')).toBe(getRegistry().get('notebooklm/note-list'));
    expect(getRegistry().get('notebooklm/notes/list')).toBe(getRegistry().get('notebooklm/notes-list'));
    expect(getRegistry().get('notebooklm/notes/get')).toBe(getRegistry().get('notebooklm/notes-get'));
    expect(getRegistry().get('notebooklm/language/list')).toBe(getRegistry().get('notebooklm/language-list'));
    expect(getRegistry().get('notebooklm/language/get')).toBe(getRegistry().get('notebooklm/language-get'));
    expect(getRegistry().get('notebooklm/language/set')).toBe(getRegistry().get('notebooklm/language-set'));
  });
});
