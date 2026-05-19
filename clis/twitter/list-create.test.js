import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildListCreateRow, parseListCreateArgs } from './list-create.js';
import './list-create.js';

function createPayload(overrides = {}) {
    return {
        ok: true,
        httpStatus: 200,
        bodyText: '{}',
        bodyJson: {
            data: {
                list: {
                    id_str: '123456789',
                    name: 'My List',
                    description: 'A list',
                    mode: 'Private',
                    ...overrides,
                },
            },
        },
    };
}

describe('twitter list-create registration', () => {
    it('registers the list-create command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-create');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['id', 'name', 'description', 'mode', 'status']);
        const nameArg = cmd?.args?.find((a) => a.name === 'name');
        expect(nameArg).toBeTruthy();
        expect(nameArg?.required).toBe(true);
        expect(nameArg?.positional).toBe(true);
        const modeArg = cmd?.args?.find((a) => a.name === 'mode');
        expect(modeArg?.default).toBe('public');
        const descArg = cmd?.args?.find((a) => a.name === 'description');
        expect(descArg?.default).toBe('');
    });

    it('rejects empty name', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects names over 25 chars', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: 'x'.repeat(26) })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects descriptions over 100 chars', () => {
        expect(() => parseListCreateArgs({ name: 'ok', description: 'x'.repeat(101) })).toThrow(ArgumentError);
    });

    it('rejects invalid mode', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: 'ok', mode: 'secret' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('reads ct0 from cookies and unwraps Browser Bridge mutation envelopes', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf-token' }]),
            evaluate: vi.fn().mockResolvedValue({ session: 'browser:default', data: createPayload() }),
        };

        const rows = await cmd.func(page, { name: 'My List', description: 'A list', mode: 'private' });

        expect(page.goto).toHaveBeenCalledWith('https://x.com');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
        expect(rows).toEqual([{ id: '123456789', name: 'My List', description: 'A list', mode: 'private', status: 'success' }]);
    });

    it('rejects missing ct0 before mutation', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { name: 'My List' })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('keeps non-fatal GraphQL errors when a valid created list payload exists', () => {
        const row = buildListCreateRow({
            result: {
                ...createPayload(),
                bodyJson: {
                    ...createPayload().bodyJson,
                    errors: [{ message: 'DecodeException' }],
                },
            },
            name: 'My List',
            description: 'A list',
            mode: 'private',
        });

        expect(row).toEqual({ id: '123456789', name: 'My List', description: 'A list', mode: 'private', status: 'success' });
    });

    it('maps mutation auth and HTTP failures to typed errors', () => {
        expect(() => buildListCreateRow({
            result: { ok: false, httpStatus: 401, bodyText: 'login' },
            name: 'My List',
            description: '',
            mode: 'public',
        })).toThrow(AuthRequiredError);

        expect(() => buildListCreateRow({
            result: { ok: false, httpStatus: 500, bodyText: 'server' },
            name: 'My List',
            description: '',
            mode: 'public',
        })).toThrow(CommandExecutionError);
    });

    it('fails typed when the mutation response lacks post-condition evidence', () => {
        for (const result of [
            createPayload({ id_str: '', id: '' }),
            createPayload({ name: '' }),
            createPayload({ mode: '' }),
        ]) {
            expect(() => buildListCreateRow({
                result,
                name: 'My List',
                description: '',
                mode: 'public',
            })).toThrow(CommandExecutionError);
        }
    });

    it('fails typed when returned list name does not match the requested name', () => {
        expect(() => buildListCreateRow({
            result: createPayload({ name: 'Other List' }),
            name: 'My List',
            description: '',
            mode: 'private',
        })).toThrow(/expected "My List"/);
    });

    it('fails typed when returned list mode does not match requested mode', () => {
        expect(() => buildListCreateRow({
            result: createPayload({ mode: 'Public' }),
            name: 'My List',
            description: '',
            mode: 'private',
        })).toThrow(/expected private/);
    });

    it('fails typed when errors appear without a list payload', () => {
        expect(() => buildListCreateRow({
            result: {
                ok: true,
                httpStatus: 200,
                bodyText: '{}',
                bodyJson: { errors: [{ message: 'duplicate name' }] },
            },
            name: 'My List',
            description: '',
            mode: 'public',
        })).toThrow(/duplicate name/);
    });
});
