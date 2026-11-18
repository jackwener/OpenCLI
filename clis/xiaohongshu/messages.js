import { cli, Strategy } from '@jackwener/opencli/registry';
import { HISTORY_ARGS, MESSAGE_COLUMNS, parseHistoryOptions } from '../_shared/private-messages.js';
import { getPrivateChats, parsePrivateUserId, readPrivateHistory } from './im.js';

export const command = cli({
    site: 'xiaohongshu', name: 'messages', access: 'read',
    description: '读取小红书指定私聊的最近 N 条、全部可访问历史或精确水位增量',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: HISTORY_ARGS, columns: MESSAGE_COLUMNS,
    validateArgs: args => { parseHistoryOptions(args); parsePrivateUserId(args.target); },
    func: async (page, args) => {
        const options = parseHistoryOptions(args);
        const target = parsePrivateUserId(args.target);
        const [chat] = await getPrivateChats(page, { target });
        return readPrivateHistory(page, chat, options);
    },
});
