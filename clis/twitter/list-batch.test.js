import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './list-add-batch.js';
import './list-remove-batch.js';
import {
    parseBatchIntervalSeconds,
    parseCommaSeparatedUsernames,
    runListBatch,
} from './list-batch-utils.js';

describe('twitter list batch utilities', () => {
    it('parses comma-separated usernames, strips @, and dedupes case-insensitively', () => {
        expect(parseCommaSeparatedUsernames('@Alice, bob,alice, @ComfyUI', 'Example'))
            .toEqual(['Alice', 'bob', 'ComfyUI']);
    });

    it('rejects empty and invalid usernames', () => {
        expect(() => parseCommaSeparatedUsernames('', 'Example')).toThrow(ArgumentError);
        expect(() => parseCommaSeparatedUsernames('@valid,bad-name', 'Example')).toThrow(ArgumentError);
    });

    it('parses interval seconds with bounds', () => {
        expect(parseBatchIntervalSeconds(undefined)).toBe(5);
        expect(parseBatchIntervalSeconds(0)).toBe(0);
        expect(parseBatchIntervalSeconds('10')).toBe(10);
        expect(() => parseBatchIntervalSeconds(-1)).toThrow(ArgumentError);
        expect(() => parseBatchIntervalSeconds(601)).toThrow(ArgumentError);
    });

    it('runs an operation for each user, waits between items, and continues after failures', async () => {
        const page = { wait: vi.fn() };
        const operation = vi.fn(async (_page, args) => {
            if (args.username === 'bad') throw new Error('Could not resolve user @bad');
            return [{
                listId: args.listId,
                username: args.username,
                userId: `${args.username}-id`,
                status: 'success',
                message: `Processed @${args.username}`,
            }];
        });

        const rows = await runListBatch({
            page,
            listId: '123',
            usernames: ['good', 'bad', 'next'],
            interval: 2,
            operation,
        });

        expect(operation).toHaveBeenCalledTimes(3);
        expect(page.wait).toHaveBeenCalledTimes(2);
        expect(page.wait).toHaveBeenCalledWith(2);
        expect(rows.map((row) => row.status)).toEqual(['success', 'failed', 'success']);
        expect(rows[1]).toMatchObject({ listId: '123', username: 'bad', userId: '', status: 'failed' });
    });

    it('does not convert global precondition failures into per-user failed rows', async () => {
        const page = { wait: vi.fn() };
        await expect(runListBatch({
            page,
            listId: 'bad',
            usernames: ['alice', 'bob'],
            interval: 0,
            operation: async () => {
                throw new ArgumentError('Invalid listId: "bad". Expected numeric ID.');
            },
        })).rejects.toBeInstanceOf(ArgumentError);

        await expect(runListBatch({
            page,
            listId: '123',
            usernames: ['alice'],
            interval: 0,
            operation: async () => {
                throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
            },
        })).rejects.toBeInstanceOf(AuthRequiredError);

        await expect(runListBatch({
            page,
            listId: '123',
            usernames: ['alice'],
            interval: 0,
            operation: async () => {
                throw new CommandExecutionError('List 123 not found among your lists.');
            },
        })).rejects.toThrow(/List 123 not found/);
    });
});

describe('twitter list-add-batch registration', () => {
    it('registers the list-add-batch command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-add-batch');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        expect(cmd?.args?.find((a) => a.name === 'interval')?.default).toBe(5);
        expect(cmd?.args?.find((a) => a.name === 'timeout')?.default).toBe(600);
    });

});

describe('twitter list-remove-batch registration', () => {
    it('registers the list-remove-batch command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-remove-batch');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        expect(cmd?.args?.find((a) => a.name === 'interval')?.default).toBe(5);
        expect(cmd?.args?.find((a) => a.name === 'timeout')?.default).toBe(600);
    });

});
