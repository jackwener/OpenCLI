import { describe, expect, it } from 'vitest';

import { CommandExecutionError } from '@jackwener/opencli/errors';

const { mapConnection } = await import('./connections.js').then((m) => m.__test__);

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

});
