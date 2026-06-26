import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { conversationTargetArgs } from './_actions.js';

// Known followup: a first attempt at rename triggered a destructive side
// effect that removed the conversation from the sidebar (the convo titled
// "1" disappeared after attempting `rename b79d8b28-... "..."` with the
// Promise eval being collected mid-way). The 3-dot menu's Rename option
// may interact with Antigravity's React state in a way that an
// incomplete eval treats as "discard" — needs more investigation before
// it's safe to ship.
//
// For now this command refuses to run; pin/delete/mark-read are wired up.
cli({
    site: 'antigravity',
    name: 'rename',
    access: 'write',
    description: 'Rename an Antigravity conversation by ID (NOT YET IMPLEMENTED — see source comment).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        ...conversationTargetArgs,
        { name: 'title', positional: true, type: 'string', required: true, help: 'New title' },
    ],
    columns: ['status'],
    func: async () => {
        throw new CommandExecutionError(
            'antigravity rename is not yet implemented — first attempt caused the conversation to be removed from the sidebar instead of renamed. Use the Antigravity UI to rename until this is fixed.',
            '',
        );
    },
});
