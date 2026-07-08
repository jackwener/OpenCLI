import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadDoubanSubjectPhotos, normalizeDoubanSubjectId } from './utils.js';
cli({
    site: 'douban',
    name: 'photos',
    access: 'read',
    description: '获取电影海报/剧照图片列表',
    domain: 'movie.douban.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: '电影 subject ID' },
        { name: 'type', default: 'Rb', help: '豆瓣 photos 的 type 参数，默认 Rb（海报）' },
        { name: 'limit', type: 'int', default: 120, help: '最多返回多少张图片' },
    ],
    columns: ['index', 'photo_id', 'subject_id', 'title', 'image_url', 'detail_url'],
    func: async (page, kwargs) => {
        const subjectId = normalizeDoubanSubjectId(String(kwargs.id || ''));
        const data = await loadDoubanSubjectPhotos(page, subjectId, {
            type: String(kwargs.type || 'Rb'),
            limit: Number(kwargs.limit) || 120,
        });
        return data.photos.map((photo) => ({
            subject_id: data.subjectId,
            subject_title: data.subjectTitle,
            type: data.type,
            index: photo.index,
            photo_id: photo.photoId,
            title: photo.title,
            image_url: photo.imageUrl,
            thumb_url: photo.thumbUrl,
            detail_url: photo.detailUrl,
            page: photo.page,
        }));
    },
});
