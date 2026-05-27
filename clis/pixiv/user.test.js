import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './user.js';
let cmd;
beforeAll(() => {
    cmd = getRegistry().get('pixiv/user');
    expect(cmd?.func).toBeTypeOf('function');
});
describe('pixiv user', () => {
    it('throws CommandExecutionError on invalid user ID', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { uid: 'abc' })).rejects.toThrow(CommandExecutionError);
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
