import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildListAddMemberRow } from './list-add.js';

describe('twitter list-add registration', () => {
    it('registers the list-add command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-add');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        const listIdArg = cmd?.args?.find((a) => a.name === 'listId');
        expect(listIdArg).toBeTruthy();
        expect(listIdArg?.required).toBe(true);
        expect(listIdArg?.positional).toBe(true);
    });

    it('keeps the x.com root navigation before pre-target GraphQL calls', async () => {
        const cmd = getRegistry().get('twitter/list-add');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce(null) // UserByScreenName queryId fallback
                .mockResolvedValueOnce('user-1')
                .mockResolvedValueOnce(null) // ListsManagement queryId fallback
                .mockResolvedValueOnce({}),
        };

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects
            .toThrow(/List 123 not found/);
        expect(page.goto).toHaveBeenCalledWith('https://x.com');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
    });

    it('rejects invalid user input before navigation', async () => {
        const cmd = getRegistry().get('twitter/list-add');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { listId: 'abc', username: 'alice' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { listId: '123', username: '' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('builds success rows when member_count increases despite non-fatal decode errors', () => {
        const row = buildListAddMemberRow({
            addResult: {
                httpOk: true,
                status: 200,
                mc: 11,
                isMember: true,
                errors: [{ path: ['data', 'list', 'default_banner_media_results'], message: 'decode failed' }],
            },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        });

        expect(row).toMatchObject({
            listId: '123',
            username: 'alice',
            userId: '42',
            status: 'success',
        });
        expect(row.message).toContain('member_count 10 → 11');
    });

    it('treats unchanged member_count as noop only when membership is confirmed', () => {
        const row = buildListAddMemberRow({
            addResult: { httpOk: true, status: 200, mc: 10, isMember: true, errors: null },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        });

        expect(row.status).toBe('noop');
        expect(row.message).toBe('@alice is already a member of list 123');
    });

    it('fails typed when unchanged member_count does not confirm membership', () => {
        expect(() => buildListAddMemberRow({
            addResult: { httpOk: true, status: 200, mc: 10, isMember: false, errors: null },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        })).toThrow(CommandExecutionError);
    });

    it('fails typed when member_count decreases unexpectedly', () => {
        expect(() => buildListAddMemberRow({
            addResult: { httpOk: true, status: 200, mc: 9, isMember: true, errors: null },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        })).toThrow(/decreased unexpectedly/);
    });

    it('fails typed when GraphQL response has no usable member_count', () => {
        expect(() => buildListAddMemberRow({
            addResult: {
                httpOk: true,
                status: 200,
                mc: undefined,
                isMember: null,
                errors: [{ message: 'List is unavailable', path: ['data', 'list'] }],
            },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        })).toThrow(/List is unavailable/);

        expect(() => buildListAddMemberRow({
            addResult: { httpOk: true, status: 200, mc: null, isMember: null, errors: { message: 'not an array' } },
            memberCountBefore: 10,
            listId: '123',
            username: 'alice',
            userId: '42',
        })).toThrow(/no member_count/);
    });
});
