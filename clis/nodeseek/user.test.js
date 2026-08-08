import { getRegistry } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './user.js';

// Mock page where ensureNsHome's render check passes and the fetchNsJson
// evaluate returns the given HTTP envelope.
function makePage({ ok = true, status = 200, detail = null }) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (js) => {
            if (js.includes('__config__')) return true;
            return { ok, status, data: { detail } };
        }),
    };
}

describe('nodeseek user', () => {
    it('accepts a numeric member id', () => {
        expect(__test__.parseMemberId('6467')).toBe('6467');
        expect(__test__.parseMemberId(' 6467 ')).toBe('6467');
    });

    it('rejects a non-numeric member id', () => {
        expect(() => __test__.parseMemberId('cary')).toThrow();
        expect(() => __test__.parseMemberId('')).toThrow();
    });

    it('projects an account detail into the user row, preferring created_at_str', () => {
        const row = __test__.mapUser({
            member_id: 6467, member_name: 'Cary', rank: 4, coin: 1757,
            nPost: 194, nComment: 1809, follows: 0, fans: 8, bio: '',
            created_at: '2023-07-20T00:00:00.000Z', created_at_str: '1066days ago',
        });
        expect(row).toMatchObject({
            member_id: 6467, member_name: 'Cary', rank: 4,
            created_at: '1066days ago',
            profile: 'https://www.nodeseek.com/space/6467',
        });
    });

    it('registers user with a positional id arg', () => {
        const command = getRegistry().get('nodeseek/user');
        expect(command).toBeDefined();
        expect(command?.args?.[0]).toMatchObject({ name: 'id', positional: true, required: true });
    });

    const command = getRegistry().get('nodeseek/user');

    it('maps a successful getInfo response into a row', async () => {
        const page = makePage({ detail: { member_id: 6467, member_name: 'Cary', rank: 4 } });
        const rows = await command.func(page, { id: '6467' });
        expect(rows[0]).toMatchObject({ member_id: 6467, member_name: 'Cary' });
    });

    it('raises AuthRequiredError on HTTP 403', async () => {
        await expect(command.func(makePage({ ok: false, status: 403 }), { id: '6467' }))
            .rejects.toThrow(/not logged in|session|login/i);
    });

    it('raises EmptyResultError when the member is missing', async () => {
        await expect(command.func(makePage({ ok: true, status: 200, detail: null }), { id: '999999' }))
            .rejects.toThrow(EmptyResultError);
    });

    it('rejects a non-numeric id before any navigation', async () => {
        await expect(command.func(makePage({}), { id: 'cary' })).rejects.toThrow();
    });
});
