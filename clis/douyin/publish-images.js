import { cli, Strategy } from '@jackwener/opencli/registry';
import { runComposer, validateOptions } from './_shared/creator-composer.js';

cli({
    site: 'douyin', name: 'publish-images', access: 'write', browser: true,
    domain: 'creator.douyin.com', strategy: Strategy.COOKIE, siteSession: 'persistent', navigateBefore: false,
    description: '发布多图图文（默认只填写预览；--publish 才提交，--save-draft 存草稿）',
    args: [
        { name: 'images', positional: true, required: true, help: '1–35 张本地图片路径，逗号分隔（jpg/png/webp，单张 ≤50MB）' },
        { name: 'title', required: true, help: '图文标题（≤20字）' },
        { name: 'caption', default: '', help: '图文正文（≤1000字；话题实体请在预览中人工确认）' },
        { name: 'visibility', default: 'private', choices: ['public', 'friends', 'private'], help: '默认仅自己可见' },
        { name: 'publish', type: 'bool', default: false, help: '明确授权提交发布；结果未知时不自动重试' },
        { name: 'save-draft', type: 'bool', default: false, help: '暂存离开；不能与 --publish 同用' },
    ],
    columns: ['status', 'kind', 'title', 'visibility', 'submitted', 'message'],
    func: async (page, args) => runComposer(page, validateOptions('image', args)),
});
