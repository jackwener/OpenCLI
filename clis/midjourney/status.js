import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchJobStatus, jobStatusRow, parseJobId } from './utils.js';

cli({
  site: 'midjourney',
  name: 'status',
  access: 'read',
  description: 'Show the current state and metadata of one Midjourney job',
  example: 'opencli midjourney status d5664250-5f1f-4cd0-9637-2ce0153dd30a -f yaml',
  domain: 'www.midjourney.com',
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: 'https://www.midjourney.com/imagine',
  args: [{ name: 'job', positional: true, required: true, help: 'Job UUID or Midjourney /jobs/<uuid> URL' }],
  columns: [
    'job_id', 'parent_job_id', 'status', 'progress_pct', 'operation', 'model', 'resolution', 'created_at',
    'batch_size', 'error', 'url',
  ],
  func: async (page, kwargs) => {
    const jobId = parseJobId(kwargs.job);
    const job = await fetchJobStatus(page, jobId);
    const row = jobStatusRow(job);
    return [{
      job_id: row.jobId,
      parent_job_id: row.parentJobId,
      status: row.status,
      progress_pct: row.progressPct,
      operation: row.operation,
      model: row.model,
      resolution: row.resolution,
      created_at: row.createdAt,
      batch_size: row.batchSize,
      error: row.error,
      url: row.url,
    }];
  },
});
