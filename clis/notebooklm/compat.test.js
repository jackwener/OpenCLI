import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './get.js';
import './note-list.js';
import './open.js';
describe('notebooklm compatibility aliases', () => {
    it('registers select as a compatibility alias for open', () => {
        expect(getRegistry().get('notebooklm/select')).toBe(getRegistry().get('notebooklm/open'));
    });
    it('registers metadata as a compatibility alias for get', () => {
        expect(getRegistry().get('notebooklm/metadata')).toBe(getRegistry().get('notebooklm/get'));
    });
    it('registers notes-list as a compatibility alias for note-list', () => {
        expect(getRegistry().get('notebooklm/notes-list')).toBe(getRegistry().get('notebooklm/note-list'));
    });
});
