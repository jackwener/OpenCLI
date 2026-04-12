import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './note.js';
import './comments.js';
import './download.js';
import './search.js';
import './user.js';
import './publish.js';
import './creator-notes.js';
import './creator-note-detail.js';
import './creator-notes-summary.js';
import './creator-profile.js';
import './creator-stats.js';

describe('xiaohongshu navigateBefore hardening', () => {
    const expectedFalse = [
        'xiaohongshu/note',
        'xiaohongshu/comments',
        'xiaohongshu/download',
        'xiaohongshu/search',
        'xiaohongshu/user',
        'xiaohongshu/publish',
        'xiaohongshu/creator-notes',
        'xiaohongshu/creator-note-detail',
        'xiaohongshu/creator-notes-summary',
        'xiaohongshu/creator-profile',
        'xiaohongshu/creator-stats',
    ];
    it.each(expectedFalse)('%s sets navigateBefore=false', (name) => {
        const cmd = getRegistry().get(name);
        expect(cmd).toBeDefined();
        expect(cmd.navigateBefore).toBe(false);
    });
});
