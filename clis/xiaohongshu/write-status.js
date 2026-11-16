import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseWriteOptions, readWriteReceipt } from '../_shared/social-write.js';
export const command = cli({
    site: 'xiaohongshu', name: 'write-status', access: 'read', description: '读取本地审批写入回执；unknown 不解锁、不自动重发',
    strategy: Strategy.LOCAL, browser: false,
    args: [{ name: 'request-id', positional: true, required: true, help: 'Execution request UUID' }],
    columns: ['request_id', 'status', 'conversation_id', 'message_id', 'payload_hash'],
    validateArgs: args => { parseWriteOptions({ 'request-id': args['request-id'] }); },
    func: async (_page, args) => readWriteReceipt('xiaohongshu', args['request-id']),
});
