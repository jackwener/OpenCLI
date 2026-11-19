/**
 * Wellfound Browse jobs reader.
 *
 * Strategy note:
 * Strategy: UI_SELECTOR
 * Contract: visible-ui
 * Evidence:
 * - observed state: /jobs renders visible company cards and job links; opening a
 *   job only adds ?job_listing_slug=<id-slug> and keeps the search context.
 * - auth source: signed-in browser session; no cookies or tokens are read.
 * - replay result: DOM extraction returns the visible card fields users compare.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  assertAuthenticated,
  buildJobsExtractionScript,
  buildJobsUrl,
  JOB_COLUMNS,
  normalizeJobRows,
  parseLimit,
  unwrapEvaluateResult,
} from './utils.js';

cli({
  site: 'wellfound',
  name: 'jobs',
  access: 'read',
  description: 'Read visible Wellfound Browse jobs from the current saved/filtered search',
  domain: 'wellfound.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', type: 'string', default: 'https://wellfound.com/jobs', help: 'Wellfound jobs URL to open; defaults to Browse all jobs' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of visible job cards to return (1-50)' },
  ],
  columns: JOB_COLUMNS,
  func: async (page, args) => {
    const limit = parseLimit(args.limit, 20, 50);
    await page.goto(buildJobsUrl(args));
    await page.wait(4);
    await assertAuthenticated(page, 'wellfound jobs');
    const payload = unwrapEvaluateResult(await page.evaluate(buildJobsExtractionScript()));
    return normalizeJobRows(payload, limit, 'wellfound jobs');
  },
});
