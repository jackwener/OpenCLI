import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  fetchHistoryPage,
  fetchJobStatuses,
  getMidjourneyAccount,
  isVideoJob,
  jobStatusRow,
  normalizePositiveInt,
  promptFromFullCommand,
} from './utils.js';

const TYPE_CHOICES = ['all', 'image', 'video'];
const STATUS_CHOICES = ['all', 'queued', 'running', 'completed', 'failed', 'cancelled'];

function choice(value, fallback, choices, label) {
  const result = String(value ?? fallback).trim().toLowerCase();
  if (!choices.includes(result)) throw new ArgumentError(`${label} must be one of: ${choices.join(', ')}`);
  return result;
}

cli({
  site: 'midjourney',
  name: 'history',
  access: 'read',
  description: 'List recent Midjourney image, video, and derived jobs with real lifecycle status',
  example: 'opencli midjourney history --limit 10 --type all -f json',
  domain: 'www.midjourney.com',
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: 'https://www.midjourney.com/imagine',
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of matching jobs (1..100)' },
    { name: 'type', default: 'all', help: 'all, image, or video' },
    { name: 'status', default: 'all', help: 'all, queued, running, completed, failed, or cancelled' },
    { name: 'query', help: 'Case-insensitive prompt substring' },
  ],
  columns: [
    'job_id', 'parent_job_id', 'status', 'type', 'operation', 'model', 'resolution', 'created_at',
    'batch_size', 'command', 'url',
  ],
  func: async (page, kwargs) => {
    const limit = normalizePositiveInt(kwargs.limit, 10, 100, '--limit');
    const type = choice(kwargs.type, 'all', TYPE_CHOICES, '--type');
    const wantedStatus = choice(kwargs.status, 'all', STATUS_CHOICES, '--status');
    const query = String(kwargs.query || '').trim().toLowerCase();
    const account = await getMidjourneyAccount(page);
    const rows = [];
    const seen = new Set();
    let cursor = null;

    for (let pageNumber = 0; pageNumber < 10 && rows.length < limit; pageNumber += 1) {
      const result = await fetchHistoryPage(page, account.user_id, 100, cursor);
      const pageJobs = result.data.filter((job) => job?.id && !seen.has(job.id));
      pageJobs.forEach((job) => seen.add(job.id));
      const statuses = await fetchJobStatuses(page, pageJobs.map((job) => job.id));
      const byId = new Map(statuses.map((job) => [job.id, job]));
      for (const summary of pageJobs) {
        const job = { ...summary, ...(byId.get(summary.id) || {}) };
        const video = isVideoJob(job);
        const normalized = jobStatusRow(job);
        const command = promptFromFullCommand(job.full_command) || null;
        if (type !== 'all' && type !== (video ? 'video' : 'image')) continue;
        if (wantedStatus !== 'all' && normalized.status !== wantedStatus) continue;
        if (query && !String(command || '').toLowerCase().includes(query)) continue;
        rows.push({
          job_id: normalized.jobId,
          parent_job_id: normalized.parentJobId,
          status: normalized.status,
          type: video ? 'video' : 'image',
          operation: normalized.operation,
          model: normalized.model,
          resolution: normalized.resolution,
          created_at: normalized.createdAt,
          batch_size: normalized.batchSize,
          command,
          url: normalized.url,
        });
        if (rows.length >= limit) break;
      }
      if (!result.cursor || result.cursor === cursor || !pageJobs.length) break;
      cursor = result.cursor;
    }
    if (!rows.length) throw new EmptyResultError('midjourney history', 'No jobs matched the requested filters.');
    return rows.slice(0, limit);
  },
});
