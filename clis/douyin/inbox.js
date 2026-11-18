import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { INBOX_COLUMNS, positiveInteger } from '../_shared/private-messages.js';
import { evaluateIm, openPrivateMessages, projectInboxChat } from './im.js';

export const command = cli({
    site: 'douyin', name: 'inbox', access: 'read',
    description: '获取抖音私聊会话列表（不主动标记已读）',
    domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Maximum matching private conversations (1-1000)' },
        { name: 'unread', type: 'bool', default: false, help: 'Only unread private conversations; filter before applying limit' },
    ],
    columns: INBOX_COLUMNS,
    validateArgs: args => { positiveInteger(args.limit, 20, 1000, '--limit'); },
    func: async (page, args) => {
        const limit = positiveInteger(args.limit, 20, 1000, '--limit');
        await openPrivateMessages(page);
        const result = await evaluateIm(page, 'list', { limit, ...(args.unread ? { unreadOnly: true } : {}) });
        if (!Array.isArray(result.chats)) throw new CommandExecutionError('Douyin inbox is missing the conversation list');
        if (result.chats.length === 0) throw new EmptyResultError('douyin inbox', 'No private conversations are available.');
        const seen = new Set();
        const chats = result.chats.filter(chat => {
            if (seen.has(chat.threadId)) return false;
            seen.add(chat.threadId);
            return true;
        }).sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0));
        return chats.slice(0, limit).map(projectInboxChat);
    },
});
