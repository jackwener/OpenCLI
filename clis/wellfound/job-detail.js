import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  assertAuthenticated,
  buildDetailExtractionScript,
  buildDetailUrl,
  DETAIL_COLUMNS,
  normalizeDetailRow,
  normalizeJobSlug,
  unwrapEvaluateResult,
} from './utils.js';

cli({
  site: 'wellfound',
  name: 'job-detail',
  access: 'read',
  description: 'Read one Wellfound job detail dialog with description, skills, remote policy, and company metadata',
  domain: 'wellfound.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'job-url', type: 'string', required: true, positional: true, help: 'Wellfound /jobs/<id-slug> URL, ?job_listing_slug URL, or raw id-slug' },
  ],
  columns: DETAIL_COLUMNS,
  func: async (page, args) => {
    const slug = normalizeJobSlug(args['job-url']);
    await page.goto(buildDetailUrl(slug));
    await page.wait(4);
    await assertAuthenticated(page, 'wellfound job-detail');
    const payload = unwrapEvaluateResult(await page.evaluate(buildDetailExtractionScript()));
    return [normalizeDetailRow(payload)];
  },
});
