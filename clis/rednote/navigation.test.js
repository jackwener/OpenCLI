import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './note.js';
import './comments.js';
import './download.js';
import './feed.js';
import './notifications.js';
import './search.js';
import './user.js';

describe('rednote navigateBefore hardening', () => {
    const expectedFalse = [
        'rednote/note',
        'rednote/comments',
        'rednote/download',
        'rednote/feed',
        'rednote/notifications',
        'rednote/search',
        'rednote/user',
    ];
    it.each(expectedFalse)('%s sets navigateBefore=false', (name) => {
        const cmd = getRegistry().get(name);
        expect(cmd).toBeDefined();
        expect(cmd.navigateBefore).toBe(false);
    });
});
