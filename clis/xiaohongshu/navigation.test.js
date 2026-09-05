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
import './saved.js';
import './liked.js';
import './ask.js';
import './follow.js';
import './unfollow.js';
import './feed.js';
import './delete-note.js';
import './drafts.js';
import './draft-open.js';
import './draft-delete.js';
import './draft-clear.js';

describe('xiaohongshu navigateBefore hardening', () => {
    const expectedFalse = [
        'xiaohongshu/note',
        'xiaohongshu/comments',
        'xiaohongshu/download',
        'xiaohongshu/search',
        'xiaohongshu/user',
        'xiaohongshu/saved',
        'xiaohongshu/liked',
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

describe('xiaohongshu siteSession phase boundary', () => {
    // Phase-1 persistent conversions: commands whose navigation target is
    // either parameterized (a new URL navigates for real every time) or a
    // fixed URL whose repeat goto safely fast-paths on a warm tab.
    const persistent = [
        'xiaohongshu/note',
        'xiaohongshu/comments',
        'xiaohongshu/download',
        'xiaohongshu/ask',
        'xiaohongshu/creator-profile',
        'xiaohongshu/creator-stats',
        'xiaohongshu/follow',
        'xiaohongshu/unfollow',
    ];
    it.each(persistent)('%s opts into the persistent site session', (name) => {
        const cmd = getRegistry().get(name);
        expect(cmd).toBeDefined();
        expect(cmd.siteSession).toBe('persistent');
    });

    // Deliberately NOT converted (do not flip these without solving their
    // documented hazard): feed/user/saved/liked read page state that goes
    // stale on a warm tab; search replaces the session tab; the creator
    // capture trio needs navigation to fire signed XHRs; publish/delete-note
    // and the draft commands would inherit a dirty composer.
    const ephemeral = [
        'xiaohongshu/search',
        'xiaohongshu/user',
        'xiaohongshu/saved',
        'xiaohongshu/liked',
        'xiaohongshu/feed',
        'xiaohongshu/publish',
        'xiaohongshu/delete-note',
        'xiaohongshu/drafts',
        'xiaohongshu/draft-open',
        'xiaohongshu/draft-delete',
        'xiaohongshu/draft-clear',
        'xiaohongshu/creator-notes',
        'xiaohongshu/creator-note-detail',
        'xiaohongshu/creator-notes-summary',
    ];
    it.each(ephemeral)('%s stays on the ephemeral default', (name) => {
        const cmd = getRegistry().get(name);
        expect(cmd).toBeDefined();
        expect(cmd.siteSession).toBeUndefined();
    });
});
