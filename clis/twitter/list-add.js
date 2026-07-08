import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildListAddMemberRow, listAddUser } from './list-add-core.js';

cli({
    site: 'twitter',
    name: 'list-add',
    access: 'write',
    description: 'Add a user to a Twitter/X list you own (no-op if already a member)',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'username', positional: true, type: 'string', required: true, help: 'Twitter/X handle to add (with or without @)' },
    ],
    columns: ['listId', 'username', 'userId', 'status', 'message'],
    func: listAddUser,
});

export { buildListAddMemberRow, listAddUser };
