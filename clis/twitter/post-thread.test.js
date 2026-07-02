import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './post.js';
import './reply.js';
import './post-thread.js';
import { parseThreadSegments } from './post-thread.js';

describe('parseThreadSegments', () => {
    it('splits on lines containing only ---', () => {
        expect(parseThreadSegments('a\n---\nb\n---\nc')).toEqual(['a', 'b', 'c']);
    });
    it('preserves internal blank lines within a segment when --- is used', () => {
        expect(parseThreadSegments('line1\n\nline2\n---\nnext')).toEqual(['line1\n\nline2', 'next']);
    });
    it('falls back to blank-line splitting when no --- present', () => {
        expect(parseThreadSegments('a\n\nb\n\nc')).toEqual(['a', 'b', 'c']);
    });
    it('drops empty segments and trims', () => {
        expect(parseThreadSegments('  a  \n---\n\n---\n b ')).toEqual(['a', 'b']);
    });
    it('throws when there is no content', () => {
        expect(() => parseThreadSegments('   \n---\n   ')).toThrow();
    });
});

describe('twitter post-thread', () => {
    it('registers as a UI browser write command', () => {
        const cmd = getRegistry().get('twitter/post-thread');
        expect(cmd).toBeDefined();
        expect(cmd.browser).toBe(true);
        expect(cmd.access).toBe('write');
    });

    it('posts the first tweet, then chains the rest as replies', async () => {
        const post = getRegistry().get('twitter/post');
        const reply = getRegistry().get('twitter/reply');
        const postSpy = vi.spyOn(post, 'func').mockResolvedValue([
            { status: 'success', url: 'https://x.com/u/status/1' },
        ]);
        const replySpy = vi.spyOn(reply, 'func')
            .mockResolvedValueOnce([{ status: 'success', url: 'https://x.com/u/status/2' }])
            .mockResolvedValueOnce([{ status: 'success', url: 'https://x.com/u/status/3' }]);

        const cmd = getRegistry().get('twitter/post-thread');
        const rows = await cmd.func({}, { text: 'one\n---\ntwo\n---\nthree', delay: 0 });

        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(replySpy).toHaveBeenCalledTimes(2);
        // second reply chains onto the first reply's URL
        expect(replySpy.mock.calls[1][1]).toMatchObject({ url: 'https://x.com/u/status/2', text: 'three' });
        expect(rows.map((r) => r.url)).toEqual([
            'https://x.com/u/status/1',
            'https://x.com/u/status/2',
            'https://x.com/u/status/3',
        ]);
        expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
        postSpy.mockRestore();
        replySpy.mockRestore();
    });

    it('aborts the chain when a tweet fails', async () => {
        const post = getRegistry().get('twitter/post');
        const reply = getRegistry().get('twitter/reply');
        const postSpy = vi.spyOn(post, 'func').mockResolvedValue([
            { status: 'success', url: 'https://x.com/u/status/1' },
        ]);
        const replySpy = vi.spyOn(reply, 'func').mockResolvedValue([
            { status: 'failed', message: 'rate limited' },
        ]);

        const cmd = getRegistry().get('twitter/post-thread');
        const rows = await cmd.func({}, { text: 'one\n---\ntwo\n---\nthree', delay: 0 });

        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(replySpy).toHaveBeenCalledTimes(1); // stops after the first failed reply
        expect(rows.some((r) => r.status === 'aborted')).toBe(true);
        postSpy.mockRestore();
        replySpy.mockRestore();
    });
});
