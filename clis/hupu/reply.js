import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { postHupuJson } from './utils.js';
cli({
    site: 'hupu',
    name: 'reply',
    access: 'write',
    description: '回复虎扑帖子 (需要登录)',
    domain: 'bbs.hupu.com',
    strategy: Strategy.COOKIE, // 需要Cookie认证
    navigateBefore: false,
    args: [
        {
            name: 'tid',
            required: true,
            positional: true,
            help: '帖子ID（9位数字）'
        },
        {
            name: 'topic_id',
            required: true,
            help: '板块ID，即接口中的 topicId（如 502 篮球资讯）'
        },
        {
            name: 'text',
            required: true,
            positional: true,
            help: '回复内容'
        },
        {
            name: 'quote_id',
            help: '被引用回复的 pid；填写后会以“回复某条热门回复”的方式发言'
        }
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        const { tid, topic_id, text, quote_id } = kwargs;
        const url = 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/createReply';
        // 虎扑内容用 <p> 包裹
        const content = `<p>${text}</p>`;
        // 构建请求体
        const body = {
            topicId: topic_id,
            content,
            shumeiId: '',
            deviceid: '',
            tid
        };
        // 如果有引用回复ID，添加到请求体
        if (quote_id) {
            body.quoteId = quote_id;
        }
        try {
            const result = await postHupuJson(page, tid, url, body, 'Reply to Hupu thread', 'reply');
            if (result.code === 1) {
                return [{
                        status: '✅ 回复成功',
                        message: result.msg || result.message || ''
                    }];
            }
            else {
                throw new Error(`接口错误 code=${result.code}: ${result.msg || result.message}`);
            }
        }
        catch (error) {
            if (error instanceof CliError)
                throw error;
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`回复失败: ${errorMessage}`);
        }
    },
});
