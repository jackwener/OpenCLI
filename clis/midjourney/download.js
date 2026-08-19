import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  displayPath,
  downloadOriginals,
  downloadRawVideo,
  downloadRenderedVideo,
  fetchJobStatus,
  isVideoJob,
  normalizeBoolean,
  parseImageIndices,
  parseJobId,
  resolveOutputDir,
} from './utils.js';

const KINDS = ['auto', 'image', 'video-raw', 'video-social', 'gif'];

cli({
  site: 'midjourney',
  name: 'download',
  access: 'write',
  description: 'Download original images, raw video, social MP4, or GIF with MIME and atomic-write checks',
  example: 'opencli midjourney download <job> --kind auto --index all',
  domain: 'www.midjourney.com',
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: 'https://www.midjourney.com/imagine',
  defaultFormat: 'plain',
  args: [
    { name: 'job', positional: true, required: true, help: 'Job UUID or Midjourney /jobs/<uuid> URL' },
    { name: 'index', default: 'all', help: 'Candidate 1..4 or all' },
    { name: 'kind', default: 'auto', help: 'auto, image, video-raw, video-social, or gif' },
    { name: 'output', default: '~/Pictures/Midjourney', help: 'Output directory' },
    { name: 'force', type: 'boolean', default: false, help: 'Overwrite existing non-empty files' },
  ],
  columns: ['job_id', 'status', 'kind', 'index', 'file', 'bytes', 'mime', 'url'],
  func: async (page, kwargs) => {
    const jobId = parseJobId(kwargs.job);
    const job = await fetchJobStatus(page, jobId);
    const status = String(job.current_status || job.status || '').toLowerCase();
    if (status !== 'completed') {
      throw new CommandExecutionError(`Midjourney job ${jobId} is "${status || 'missing'}"; media is available after completion.`);
    }
    const video = isVideoJob(job);
    let kind = String(kwargs.kind || 'auto').trim().toLowerCase();
    if (!KINDS.includes(kind)) throw new ArgumentError(`--kind must be one of: ${KINDS.join(', ')}`);
    if (kind === 'auto') kind = video ? 'video-raw' : 'image';
    if (video && kind === 'image') throw new ArgumentError('Video jobs support video-raw, video-social, or gif downloads');
    if (!video && kind !== 'image') throw new ArgumentError('Image jobs only support --kind image');

    const indices = parseImageIndices(kwargs.index, Number(job.batch_size || (video ? 1 : 4)));
    const outputDir = resolveOutputDir(kwargs.output);
    const force = normalizeBoolean(kwargs.force);
    let files;
    if (kind === 'image') {
      files = (await downloadOriginals(page, jobId, indices, outputDir, force)).map((item) => ({
        ...item,
        kind: 'image',
      }));
    } else if (kind === 'video-raw') {
      files = [];
      for (const index of indices) files.push(await downloadRawVideo(page, jobId, index, outputDir, force));
    } else {
      files = [];
      for (const index of indices) files.push(await downloadRenderedVideo(page, jobId, index, kind, outputDir, force));
    }
    return files.map((item) => ({
      job_id: jobId,
      status: item.cached ? 'cached' : 'downloaded',
      kind: item.kind,
      index: item.index + 1,
      file: displayPath(item.filePath),
      bytes: item.bytes,
      mime: item.mime,
      url: item.url,
    }));
  },
});
