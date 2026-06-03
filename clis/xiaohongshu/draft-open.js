import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    draftNotFound,
    ensureDraftDbPage,
    findDraftEntry,
    normalizeDraftId,
    normalizeDraftRecord,
    normalizeDraftType,
    readDraftEntries,
} from './draft-utils.js';

cli({
    site: 'xiaohongshu',
    name: 'draft-open',
    access: 'read',
    description: '读取一条小红书本地草稿详情',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Draft id returned by `opencli xiaohongshu drafts`' },
        { name: 'type', default: 'image', help: 'Draft type: image, video, article, audio' },
    ],
    columns: ['id', 'type', 'title', 'updated_at', 'images', 'content'],
    func: async (page, kwargs) => {
        const id = normalizeDraftId(kwargs.id);
        const draftType = normalizeDraftType(kwargs.type);
        await ensureDraftDbPage(page);
        const entries = await readDraftEntries(page, draftType);
        const entry = findDraftEntry(entries, id);
        if (!entry) throw draftNotFound(id, draftType, 'xiaohongshu/draft-open');
        const row = normalizeDraftRecord(entry.row, entry.key, draftType, 1, { contentLimit: 500 });
        return [{
            id: row.id,
            type: row.type,
            title: row.title,
            updated_at: row.updated_at,
            images: row.images,
            content: row.text_preview,
        }];
    },
});
