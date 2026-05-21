import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './write-note.js';

const { parseNoteTitle, parseNoteContent, buildCreateNoteShellArgs, buildMutateNoteArgs, parseNoteIdFromResult } = __test__;

describe('notebooklm write-note', () => {
    it('parseNoteTitle accepts 1-200 char titles', () => {
        expect(parseNoteTitle('Note A')).toBe('Note A');
        expect(parseNoteTitle('  spaced  ')).toBe('spaced');
        expect(parseNoteTitle('x'.repeat(200))).toHaveLength(200);
    });

    it('parseNoteTitle rejects empty / too-long titles', () => {
        expect(() => parseNoteTitle('')).toThrow(ArgumentError);
        expect(() => parseNoteTitle('   ')).toThrow(ArgumentError);
        expect(() => parseNoteTitle('x'.repeat(201))).toThrow(ArgumentError);
    });

    it('parseNoteContent accepts non-empty content', () => {
        expect(parseNoteContent('# heading\n\nbody')).toBe('# heading\n\nbody');
    });

    it('parseNoteContent rejects empty content', () => {
        expect(() => parseNoteContent('')).toThrow(ArgumentError);
        expect(() => parseNoteContent(undefined)).toThrow(ArgumentError);
    });

    it('buildCreateNoteShellArgs matches the HAR-verified wire format', () => {
        expect(buildCreateNoteShellArgs('nb-123')).toEqual([
            'nb-123', '', [1], null, 'New Note', null, [2],
        ]);
    });

    it('buildMutateNoteArgs puts content before title in the inner tuple', () => {
        expect(buildMutateNoteArgs('nb-123', 'note-7', 'body content', 'title-x')).toEqual([
            'nb-123', 'note-7', [[['body content', 'title-x', [], 0]]], [2],
        ]);
    });

    it('parseNoteIdFromResult walks the tree for the note-id UUID', () => {
        const id = '0312fc89-075e-4b3a-810d-141fc8d5af6d';
        expect(parseNoteIdFromResult([[[ [id] ]]])).toBe(id);
        expect(parseNoteIdFromResult({ shell: { noteId: id } })).toBe(id);
    });

    it('parseNoteIdFromResult ignores non-UUID strings', () => {
        expect(parseNoteIdFromResult([ 'project-id', 'not-a-uuid' ])).toBe('');
        expect(parseNoteIdFromResult(null)).toBe('');
        expect(parseNoteIdFromResult([])).toBe('');
    });

    it('parseNoteIdFromResult skips the input notebook id before selecting the created note id', () => {
        const notebookId = '17e2b882-6a01-4c6c-9262-0738dfa2abee';
        const noteId = '0312fc89-075e-4b3a-810d-141fc8d5af6d';
        expect(parseNoteIdFromResult([notebookId, [[noteId]]], [notebookId])).toBe(noteId);
    });

    it('refuses to create a remote note without --execute', async () => {
        const command = getRegistry().get('notebooklm/write-note');
        const page = { goto: vi.fn() };
        await expect(command.func(page, {
            notebook: '17e2b882-6a01-4c6c-9262-0738dfa2abee',
            title: 'Draft note',
            content: 'body',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
