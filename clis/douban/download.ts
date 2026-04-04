import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatBytes } from '../../download/progress.js';
import { httpDownload, sanitizeFilename } from '../../download/index.js';
import { EmptyResultError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { DoubanSubjectPhoto, LoadDoubanSubjectPhotosOptions } from './utils.js';
import { getDoubanPhotoExtension, loadDoubanSubjectPhotos, normalizeDoubanSubjectId } from './utils.js';

function buildDoubanPhotoFilename(subjectId: string, photo: DoubanSubjectPhoto): string {
  const index = String(photo.index).padStart(3, '0');
  const suffix = sanitizeFilename(photo.title || photo.photoId || 'photo', 80) || 'photo';
  return `${subjectId}_${index}_${photo.photoId || 'photo'}_${suffix}${getDoubanPhotoExtension(photo.imageUrl)}`;
}

cli({
  site: 'douban',
  name: 'download',
  description: '下载电影海报/剧照图片',
  domain: 'movie.douban.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', positional: true, required: true, help: '电影 subject ID' },
    { name: 'type', default: 'Rb', help: '豆瓣 photos 的 type 参数，默认 Rb（海报）' },
    { name: 'limit', type: 'int', default: 120, help: '最多下载多少张图片' },
    { name: 'photo-id', help: '只下载指定 photo_id 的图片' },
    { name: 'output', default: './douban-downloads', help: '输出目录' },
  ],
  columns: ['index', 'title', 'status', 'size'],
  func: async (page, kwargs) => {
    const subjectId = normalizeDoubanSubjectId(String(kwargs.id || ''));
    const output = String(kwargs.output || './douban-downloads');
    const requestedPhotoId = String(kwargs['photo-id'] || '').trim();
    const loadOptions: LoadDoubanSubjectPhotosOptions = {
      type: String(kwargs.type || 'Rb'),
    };
    if (requestedPhotoId) loadOptions.targetPhotoId = requestedPhotoId;
    else loadOptions.limit = Number(kwargs.limit) || 120;

    const data = await loadDoubanSubjectPhotos(page, subjectId, loadOptions);

    const photos = requestedPhotoId
      ? data.photos.filter((photo) => photo.photoId === requestedPhotoId)
      : data.photos;

    if (requestedPhotoId && !photos.length) {
      throw new EmptyResultError(
        'douban download',
        `Photo ID ${requestedPhotoId} was not found under subject ${subjectId}. Try "douban photos ${subjectId} -f json" first.`,
      );
    }

    const outputDir = path.join(output, subjectId);
    fs.mkdirSync(outputDir, { recursive: true });

    const results: Array<Record<string, unknown>> = [];
    for (const photo of photos) {
      const filename = buildDoubanPhotoFilename(subjectId, photo);
      const destPath = path.join(outputDir, filename);
      const result = await httpDownload(photo.imageUrl, destPath, {
        headers: { Referer: photo.detailUrl || `https://movie.douban.com/subject/${subjectId}/photos?type=${encodeURIComponent(String(kwargs.type || 'Rb'))}` },
        timeout: 60000,
      });

      results.push({
        index: photo.index,
        title: photo.title,
        photo_id: photo.photoId,
        image_url: photo.imageUrl,
        detail_url: photo.detailUrl,
        status: result.success ? 'success' : 'failed',
        size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
      });
    }

    return results;
  },
});
