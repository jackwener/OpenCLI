import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './whoami.js';

function makePage(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

describe('reddit whoami command', () => {
    const command = getRegistry().get('reddit/whoami');

    it('registers with the expected shape', () => {
        expect(command).toBeDefined();
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.columns).toEqual(['field', 'value']);
        expect(command.args).toEqual([]);
    });

    it('throws AuthRequiredError on 401/403 from /api/me.json', async () => {
        const page = makePage({ kind: 'auth', detail: 'Reddit /api/me.json returned HTTP 401' });
        await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
    });

    it('throws AuthRequiredError on 200 with missing data.name (stale anon session)', async () => {
        const page = makePage({ kind: 'auth', detail: 'Not logged in to reddit.com (no identity in /api/me.json)' });
        await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError on HTTP / exception failure modes', async () => {
        await expect(command.func(makePage({ kind: 'http', httpStatus: 500, where: '/api/me.json' }), {}))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'exception', detail: 'bad json' }), {}))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps a full identity payload into the field/value rows', async () => {
        const identity = {
            name: 'alice',
            id: 'abcdef',
            link_karma: 1234,
            comment_karma: 5678,
            total_karma: 6912,
            created_utc: 1577836800, // 2020-01-01
            is_gold: true,
            is_mod: false,
            has_verified_email: true,
            has_mail: false,
            inbox_count: 0,
        };
        const page = makePage({ kind: 'ok', identity });
        const rows = await command.func(page, {});

        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(byField.Username).toBe('u/alice');
        expect(byField.ID).toBe('t2_abcdef');
        expect(byField['Post Karma']).toBe('1234');
        expect(byField['Comment Karma']).toBe('5678');
        expect(byField['Total Karma']).toBe('6912');
        expect(byField['Account Created']).toBe('2020-01-01');
        expect(byField.Gold).toBe('Yes');
        expect(byField.Mod).toBe('No');
        expect(byField['Verified Email']).toBe('Yes');
        expect(byField['Has Mail']).toBe('No');
        expect(byField['Inbox Count']).toBe('0');

        // Row shape must match the declared columns exactly so the
        // silent-column-drop audit can't be triggered.
        for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual(['field', 'value']);
        }
    });

    it('falls back to null for missing numeric karma fields rather than 0 sentinels', async () => {
        const identity = {
            name: 'bob',
            id: 'xyz',
            created_utc: null,
            is_gold: false,
            is_mod: false,
            has_verified_email: false,
            has_mail: false,
        };
        const page = makePage({ kind: 'ok', identity });
        const rows = await command.func(page, {});
        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(byField['Post Karma']).toBeNull();
        expect(byField['Comment Karma']).toBeNull();
        expect(byField['Total Karma']).toBeNull();
        expect(byField['Account Created']).toBeNull();
        expect(byField['Inbox Count']).toBeNull();
    });

    it('does not throw on `data.name` present even if optional booleans are missing', async () => {
        const identity = { name: 'carol', id: 'i1' };
        const page = makePage({ kind: 'ok', identity });
        const rows = await command.func(page, {});
        expect(rows[0]).toEqual({ field: 'Username', value: 'u/carol' });
    });
});
