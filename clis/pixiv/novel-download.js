import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { fetchNovelForDownload, normalizeNovelFileFormat, writeNovelFile } from './novel-download-utils.js';

cli({
  site: 'pixiv',
  name: 'novel-download',
  access: 'read',
  description: 'Download Pixiv novel text as txt or markdown',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'novel-id', positional: true, required: true, help: 'Novel ID' },
    { name: 'output', default: './pixiv-downloads/novels', help: 'Output directory' },
    { name: 'file-format', default: 'txt', help: 'Output file format: txt or md' },
  ],
  columns: ['novel_id', 'title', 'format', 'status', 'path'],
  func: async (page, kwargs) => {
    const id = String(kwargs['novel-id'] ?? '');
    if (!/^\d+$/.test(id)) {
      throw new ArgumentError(`Invalid novel ID: ${id}`, 'Example: opencli pixiv novel-download 10588915 --file-format txt');
    }
    const format = normalizeNovelFileFormat(kwargs['file-format'] ?? kwargs.format);
    const output = String(kwargs.output ?? './pixiv-downloads/novels');
    const body = await fetchNovelForDownload(page, id);
    const destPath = writeNovelFile(body, output, format);
    return [{ novel_id: body.id, title: body.title, format, status: 'success', path: destPath }];
  },
});
