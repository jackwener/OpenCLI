import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ensureDraftDbPage,
    normalizeDraftRecord,
    normalizeDraftType,
    readDraftEntries,
} from './draft-utils.js';

export const draftsCommand = cli({
    site: 'xiaohongshu',
    name: 'drafts',
    access: 'read',
    description: '小红书本地草稿箱列表',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'type', default: 'image', help: 'Draft type: image, video, article, audio' },
    ],
    columns: ['rank', 'id', 'type', 'title', 'updated_at', 'images', 'text_preview'],
    func: async (page, kwargs) => {
        const draftType = normalizeDraftType(kwargs.type);
        await ensureDraftDbPage(page);
        const entries = await readDraftEntries(page, draftType);
        return entries.map((entry, index) => normalizeDraftRecord(entry?.row, entry?.key, draftType, index + 1));
    },
});
