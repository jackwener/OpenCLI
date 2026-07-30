import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './connections.js';

const { mapConnection } = await import('./connections.js').then((m) => m.__test__);

function makePage({ evaluateResults = [false], cookies = [{ name: 'JSESSIONID', value: '"ajax:12345"' }] } = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookies),
        evaluate,
    };
}

const conn = (id) => ({
    createdAt: 1700000000000 + id,
    miniProfile: { firstName: 'First' + id, lastName: 'Last' + id, occupation: 'Job ' + id, publicIdentifier: 'user' + id },
});

describe('linkedin connections', () => {
    it('maps a connection element to a row', () => {
        expect(mapConnection(conn(1), 0)).toEqual({
            rank: 1,
            name: 'First1 Last1',
            occupation: 'Job 1',
            public_id: 'user1',
            connected_at: 1700000000001,
            url: 'https://www.linkedin.com/in/user1',
        });
    });

    it('throws when an element has no miniProfile', () => {
        expect(() => mapConnection({ createdAt: 1 }, 0)).toThrow(CommandExecutionError);
    });

    it('requires a stable public profile identity for every row', () => {
        expect(() => mapConnection({
            createdAt: 1,
            miniProfile: { firstName: 'Only', lastName: 'Name', occupation: 'No id' },
        }, 0)).toThrow(CommandExecutionError);
        expect(() => mapConnection({
            createdAt: 1,
            miniProfile: { firstName: 'Bad', lastName: 'Id', publicIdentifier: 'bad/id' },
        }, 0)).toThrow(CommandExecutionError);
    });

    it('fails closed for malformed miniProfile scalar fields', () => {
        expect(() => mapConnection({
            createdAt: 1,
            miniProfile: { firstName: { text: 'Alice' }, lastName: 'Example', publicIdentifier: 'alice' },
        }, 0)).toThrow(CommandExecutionError);
    });

    it('returns rows from the voyager connections API', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        expect(cmd?.func).toBeTypeOf('function');
        const page = makePage({ evaluateResults: [false, { json: { elements: [conn(1), conn(2)] } }] });
        const rows = await cmd.func(page, { limit: 2 });
        expect(rows.map((r) => r.public_id)).toEqual(['user1', 'user2']);
        expect(page.evaluate.mock.calls[1][0]).toContain('/voyager/api/relationships/connections?start=0&count=2');
        expect(page.evaluate.mock.calls[1][0]).toContain('ajax:12345');
    });

    it('throws AuthRequiredError when the connections page is an auth wall', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [true] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws AuthRequiredError when JSESSIONID is missing', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [false], cookies: [] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps an authRequired fetch result to AuthRequiredError', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [false, { authRequired: true, error: 'HTTP 403' }] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps HTML checkpoint responses to AuthRequiredError', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [false, { authRequired: true, error: 'HTML auth/checkpoint response' }] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails closed for non-JSON API drift', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [false, { error: 'response was not valid JSON' }] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when there are no connections', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage({ evaluateResults: [false, { json: { elements: [] } }] });
        await expect(cmd.func(page, { limit: 2 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects invalid limits', async () => {
        const cmd = getRegistry().get('linkedin/connections');
        const page = makePage();
        await expect(cmd.func(page, { limit: 0 })).rejects.toBeInstanceOf(CliError);
    });
});
