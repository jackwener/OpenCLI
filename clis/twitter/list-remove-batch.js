import { cli, Strategy } from '@jackwener/opencli/registry';
import { listRemoveUser } from './list-remove-core.js';
import {
    parseBatchIntervalSeconds,
    parseCommaSeparatedUsernames,
    runListBatch,
} from './list-batch-utils.js';

const EXAMPLE = 'Example: opencli twitter list-remove-batch 123456789 "@alice,@bob" --interval 5';

cli({
    site: 'twitter',
    name: 'list-remove-batch',
    access: 'write',
    description: 'Remove multiple users from a Twitter/X list you own from a comma-separated username list',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'usernames', positional: true, type: 'string', required: true, help: 'Comma-separated Twitter/X handles to remove (with or without @)' },
        { name: 'interval', type: 'int', default: 5, help: 'Seconds to wait between account removals (default: 5)' },
        { name: 'timeout', type: 'int', default: 600, help: 'Max seconds for the overall batch command (default: 600)' },
    ],
    columns: ['listId', 'username', 'userId', 'status', 'message'],
    func: async (page, kwargs) => {
        const listId = String(kwargs.listId || '').trim();
        const usernames = parseCommaSeparatedUsernames(kwargs.usernames, EXAMPLE);
        const interval = parseBatchIntervalSeconds(kwargs.interval);
        return runListBatch({ page, listId, usernames, interval, operation: listRemoveUser });
    },
});
