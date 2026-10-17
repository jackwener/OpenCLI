import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './hot.js';
import './search.js';
import './unanswered.js';
import './bounties.js';
import './read.js';
import './tag.js';
import './user.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('stackoverflow listing adapters surface question_id/tags/views/owner', () => {
    it('stackoverflow/tag exposes id so rows round-trip into read <id>', async () => {
        const cmd = getRegistry().get('stackoverflow/tag');
        expect(cmd?.columns).toEqual([
            'rank', 'id', 'title', 'score', 'answers', 'views',
            'isAnswered', 'tags', 'author', 'createdAt', 'lastActivityAt', 'url',
        ]);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                items: [{
                    question_id: 123,
                    title: 'Rust &amp; async',
                    score: 5,
                    answer_count: 2,
                    view_count: 100,
                    is_answered: true,
                    tags: ['rust', 'async'],
                    owner: { display_name: 'Ferris&#39;s friend' },
                    creation_date: 1700000000,
                    last_activity_date: 1700003600,
                    link: 'https://stackoverflow.com/questions/123/rust-async',
                }],
            }), { status: 200 }),
        ));

        const rows = await cmd.func({ tag: 'rust', sort: 'activity', limit: 1 });

        expect(rows).toEqual([expect.objectContaining({
            id: 123,
            title: 'Rust & async',
            author: "Ferris's friend",
            url: 'https://stackoverflow.com/questions/123/rust-async',
        })]);
        expect(rows[0]).not.toHaveProperty('questionId');
    });

});
