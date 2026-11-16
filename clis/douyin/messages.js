import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { HISTORY_ARGS, MESSAGE_COLUMNS, parseHistoryOptions } from '../_shared/private-messages.js';
import { evaluateIm, openPrivateMessages, parsePrivateTarget, readPrivateHistory, validatePrivateChat } from './im.js';

export const command = cli({
    site: 'douyin', name: 'messages', access: 'read',
    description: '读取抖音指定私聊的最近 N 条、全部可访问历史或精确水位增量',
    domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: HISTORY_ARGS, columns: MESSAGE_COLUMNS,
    validateArgs: args => { parseHistoryOptions(args); parsePrivateTarget(args.target); },
    func: async (page, args) => {
        const options = parseHistoryOptions(args);
        const target = parsePrivateTarget(args.target);
        await openPrivateMessages(page);
        const result = await evaluateIm(page, 'find', { target });
        const chat = validatePrivateChat(result.chat);
        if (chat.threadId !== target && chat.peerId !== target) throw new CommandExecutionError('Douyin IM selected a different private recipient');
        return readPrivateHistory(page, chat, options);
    },
});
