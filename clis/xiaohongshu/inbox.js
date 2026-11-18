import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import { INBOX_COLUMNS, positiveInteger } from '../_shared/private-messages.js';
import { fetchImJson, getPrivateChats, projectInboxChat } from './im.js';

export const command = cli({
    site: 'xiaohongshu', name: 'inbox', access: 'read',
    description: '获取小红书私聊会话列表（不主动标记已读）',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Maximum matching private conversations (1-1000)' },
        { name: 'unread', type: 'bool', default: false, help: 'Only unread private conversations; filter before applying limit' },
    ],
    columns: INBOX_COLUMNS,
    validateArgs: args => { positiveInteger(args.limit, 20, 1000, '--limit'); },
    func: async (page, args) => {
        const limit = positiveInteger(args.limit, 20, 1000, '--limit');
        const readCounts = async () => {
            const data = await fetchImJson(page, '/api/im/web/chat/get_unread');
            const counts = data.user_chat_unread_counts;
            if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new CommandExecutionError('Xiaohongshu IM returned malformed unread counts');
            return counts;
        };
        let counts;
        if (args.unread) {
            await page.goto('https://www.xiaohongshu.com/chat');
            counts = await readCounts();
        }
        const chats = await getPrivateChats(page, { limit, ...(args.unread ? { unreadCounts: counts, skipNavigation: true } : {}) });
        if (chats.length === 0) throw new EmptyResultError('xiaohongshu inbox', args.unread ? 'No unread private conversations are available.' : 'No private conversations are available.');
        counts ??= await readCounts();
        return chats.map((chat, index) => projectInboxChat(chat, index, counts));
    },
});
