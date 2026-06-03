import { cli, Strategy } from '@jackwener/opencli/registry';
import { archiveConversation, conversationSelectionArgs, resolveActionConversation } from './_actions.js';

cli({
    site: 'codex',
    name: 'archive',
    access: 'write',
    description: 'Archive (Codex\'s term for delete) the selected conversation via the Chat actions header menu. No confirmation in UI — pass --yes to actually archive.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually archive (default: dry-run preview)' },
        ...conversationSelectionArgs,
    ],
    columns: ['status', 'thread_id', 'project', 'conversation'],
    func: async (page, kwargs) => {
        const yes = kwargs.yes === true || kwargs.yes === 'true' || kwargs.yes === '1';
        if (!yes) {
            // Resolve target so the dry-run still names what WOULD be archived.
            const selected = await resolveActionConversation(page, kwargs);
            return [{
                status: 'dry-run',
                thread_id: selected.threadId,
                project: selected.project,
                conversation: selected.conversation,
            }];
        }
        const result = await archiveConversation(page, kwargs);
        return [{
            status: result.status,
            thread_id: result.selected.threadId,
            project: result.selected.project,
            conversation: result.selected.conversation,
        }];
    },
});
