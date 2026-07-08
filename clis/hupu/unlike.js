import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { postHupuJson } from './utils.js';
cli({
    site: 'hupu',
    name: 'unlike',
    access: 'write',
    description: '取消点赞虎扑回复 (需要登录)',
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
            name: 'pid',
            required: true,
            positional: true,
            help: '回复ID'
        },
        {
            name: 'fid',
            required: true,
            help: '板块ID（如278汽车区）'
        }
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        const { tid, pid, fid } = kwargs;
        const url = 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/reply/cancelLight';
        // 构建请求体（与点赞相同）
        const body = {
            tid,
            pid,
            puid: '',
            fid,
            shumei_id: '',
            deviceid: ''
        };
        try {
            const result = await postHupuJson(page, tid, url, body, 'Unlike Hupu reply');
            // 处理响应
            if (result.code === 1) {
                return [{
                        status: '✅ 取消点赞成功',
                        message: ''
                    }];
            }
            else if (result.code === 0 && result.msg === '你还没有点亮过这个回帖') {
                return [{
                        status: '⚠️ 你还没点赞过',
                        message: result.msg || ''
                    }];
            }
            else if (result.code === 0) {
                return [{
                        status: '⚠️ 操作未执行',
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
            throw new Error(`取消点赞失败: ${errorMessage}`);
        }
    },
});
