import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './user.js';
let cmd;
beforeAll(() => {
    cmd = getRegistry().get('pixiv/user');
    expect(cmd?.func).toBeTypeOf('function');
});
describe('pixiv user', () => {
    it('throws ArgumentError on invalid user ID before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { uid: 'abc' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws AuthRequiredError on 401', async () => {
        const page = createPageMock([{ __httpError: 401 }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toThrow(AuthRequiredError);
    });
    it('throws CommandExecutionError on 404', async () => {
        const page = createPageMock([{ __httpError: 404 }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toThrow(CommandExecutionError);
    });
    it('throws CommandExecutionError on non-auth HTTP failure', async () => {
        const page = createPageMock([{ __httpError: 500 }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toThrow(CommandExecutionError);
    });
    it('unwraps Browser Bridge envelopes around Pixiv API payloads', async () => {
        const page = createPageMock([
            {
                session: 'site:pixiv',
                data: {
                    body: {
                        name: 'Envelope Artist',
                        premium: false,
                        following: 0,
                        illusts: {},
                        manga: {},
                        novels: {},
                    },
                },
            },
        ]);
        const result = await cmd.func(page, { uid: '12' });
        expect(result[0]).toMatchObject({
            user_id: '12',
            name: 'Envelope Artist',
            premium: 'No',
        });
    });
    it('surfaces Pixiv API error bodies instead of treating them as not found', async () => {
        const page = createPageMock([{ error: true, message: 'rate limited' }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'rate limited',
        });
    });
    it('fails typed on malformed Pixiv API payloads', async () => {
        const page = createPageMock([{ ok: true }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed API payload'),
        });
    });
    it('fails typed when the user body lacks stable profile identity fields', async () => {
        const page = createPageMock([{ body: { premium: false, following: 0 } }]);
        await expect(cmd.func(page, { uid: '11' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed profile payload'),
        });
    });
    it('returns profile row with computed counts for object-shaped illust fields', async () => {
        const page = createPageMock([
            {
                body: {
                    name: 'Test Artist',
                    premium: true,
                    following: 42,
                    illusts: { '111': null, '222': null, '333': null },
                    manga: {},
                    novels: { '999': null },
                    comment: 'Hello world',
                },
            },
        ]);
        const result = await cmd.func(page, { uid: '11' });
        expect(result).toEqual([{
            user_id: '11',
            name: 'Test Artist',
            premium: 'Yes',
            following: 42,
            illusts: 3,
            manga: 0,
            novels: 1,
            comment: 'Hello world',
            url: 'https://www.pixiv.net/users/11',
        }]);
    });
});
