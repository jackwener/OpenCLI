import { cli, Strategy } from '@jackwener/opencli/registry';
import { runComposer, validateOptions } from './_shared/creator-composer.js';

cli({
    site: 'douyin', name: 'publish-article', access: 'write', browser: true,
    domain: 'creator.douyin.com', strategy: Strategy.COOKIE, siteSession: 'persistent', navigateBefore: false,
    description: '发布文章（UTF-8纯文本；默认仅预览，--publish 才提交）',
    args: [
        { name: 'body-file', positional: true, required: true, help: 'UTF-8 纯文本正文文件（≤20000字，保留分段；不解析 HTML/Markdown）' },
        { name: 'title', required: true, help: '文章标题（≤30字）' },
        { name: 'summary', default: '', help: '文章摘要（≤30字）' },
        { name: 'cover', default: '', help: '封面图片路径；提交或保存草稿时必填' },
        { name: 'visibility', default: 'private', choices: ['public', 'friends', 'private'], help: '默认仅自己可见' },
        { name: 'publish', type: 'bool', default: false, help: '明确授权提交发布；结果未知时不自动重试' },
        { name: 'save-draft', type: 'bool', default: false, help: '暂存离开；不能与 --publish 同用' },
    ],
    columns: ['status', 'kind', 'title', 'visibility', 'submitted', 'message'],
    func: async (page, args) => runComposer(page, validateOptions('article', args)),
});
