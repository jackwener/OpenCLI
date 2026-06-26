import { cli, Strategy } from '@jackwener/opencli/registry';
import { interpretRemoveResponse, listRemoveUser } from './list-remove-core.js';

cli({
    site: 'twitter',
    name: 'list-remove',
    access: 'write',
    description: 'Remove a user from a Twitter/X list you own (toggles via UI; no-op if not currently a member)',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'username', positional: true, type: 'string', required: true, help: 'Twitter/X handle to remove (with or without @)' },
    ],
    columns: ['listId', 'username', 'userId', 'status', 'message'],
    func: listRemoveUser,
});

export { interpretRemoveResponse, listRemoveUser };
