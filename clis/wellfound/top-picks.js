import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  assertAuthenticated,
  buildDetailExtractionScript,
  buildDetailUrl,
  buildJobsExtractionScript,
  buildJobsUrl,
  JOB_COLUMNS,
  isTopPickHardReject,
  normalizeDetailRow,
  topPickScoreMultiplier,
  normalizeJobRows,
  parseBoolean,
  parseLimit,
  unwrapEvaluateResult,
} from './utils.js';

cli({
  site: 'wellfound',
  name: 'top-picks',
  aliases: ['daily'],
  access: 'read',
  description: 'Rank the current Wellfound filtered Browse results and return the best daily application targets',
  domain: 'wellfound.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', type: 'string', default: 'https://wellfound.com/jobs', help: 'Wellfound jobs URL to open; defaults to Browse all jobs' },
    { name: 'limit', type: 'int', default: 5, help: 'Number of picks to return (1-20)' },
    { name: 'pool', type: 'int', default: 30, help: 'Visible result pool size to score before ranking (1-50)' },
    { name: 'verify-details', type: 'boolean', default: false, help: 'Open candidate detail pages before final ranking to merge company status and detail-only signals' },
  ],
  columns: JOB_COLUMNS,
  func: async (page, args) => {
    const limit = parseLimit(args.limit, 5, 20);
    const pool = Math.max(limit, parseLimit(args.pool, 30, 50));
    const verifyDetails = parseBoolean(args['verify-details'], false);
    await page.goto(buildJobsUrl(args));
    await page.wait(4);
    await assertAuthenticated(page, 'wellfound top-picks');
    const payload = unwrapEvaluateResult(await page.evaluate(buildJobsExtractionScript()));
    const sourceRows = normalizeJobRows(payload, pool, 'wellfound top-picks');
    const ranked = sourceRows
      .filter((row) => verifyDetails || !isTopPickHardReject(row))
      .map((row) => ({
        ...row,
        score: Math.round(row.score * topPickScoreMultiplier(row)),
      }))
      .sort((left, right) => right.score - left.score || left.rank - right.rank);

    const verified = verifyDetails ? [] : ranked;
    if (verifyDetails) {
      for (const row of ranked) {
        if (verified.length >= limit) break;
        await page.goto(buildDetailUrl(row.url));
        await page.wait(2);
        await assertAuthenticated(page, 'wellfound top-picks detail verification');
        const detail = normalizeDetailRow(unwrapEvaluateResult(await page.evaluate(buildDetailExtractionScript())));
        const merged = {
          ...row,
          location: detail.location || row.location,
          compensation: detail.compensation || row.compensation,
          job_type: detail.job_type || row.job_type,
          company_status: detail.company_status || row.company_status,
          raw: `${row.raw || ''} ${detail.skills || ''} ${detail.description || ''}`,
        };
        if (!isTopPickHardReject(merged)) verified.push(merged);
      }
    }

    return verified
      .slice(0, limit)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  },
});
