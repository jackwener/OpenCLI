import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  FILTER_COLUMNS,
  assertAuthenticated,
  buildFilterConfig,
  buildFilterInspectionScript,
  buildFilterUpdateScript,
  buildJobsUrl,
  buildOpenFiltersScript,
  normalizeFilterState,
  parseBoolean,
  unwrapEvaluateResult,
} from './utils.js';

cli({
  site: 'wellfound',
  name: 'filters',
  access: 'write',
  description: 'Read or update the visible Wellfound Browse filters; updates require --execute',
  domain: 'wellfound.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', type: 'string', default: 'https://wellfound.com/jobs', help: 'Wellfound jobs URL to open; defaults to Browse all jobs' },
    { name: 'preset', type: 'string', help: 'Optional filter preset, currently: ai-fullstack-remote' },
    { name: 'salary-min', type: 'string', default: '', help: 'Minimum salary filter value when supported by the UI' },
    { name: 'salary-max', type: 'string', default: '', help: 'Maximum salary filter value when supported by the UI' },
    { name: 'currency', type: 'string', default: '', help: 'Salary currency text, e.g. INR or USD' },
    { name: 'equity-min', type: 'string', default: '', help: 'Minimum equity value when supported by the UI' },
    { name: 'equity-max', type: 'string', default: '', help: 'Maximum equity value when supported by the UI' },
    { name: 'skills', type: 'string', default: '', help: 'Comma-separated skills to select; autocomplete selections may require manual UI support' },
    { name: 'markets', type: 'string', default: '', help: 'Comma-separated markets to select; autocomplete selections may require manual UI support' },
    { name: 'job-types', type: 'string', default: '', help: 'Comma-separated job types, e.g. "Full Time,Contract"' },
    { name: 'include-keywords', type: 'string', default: '', help: 'Comma-separated included keywords' },
    { name: 'exclude-keywords', type: 'string', default: '', help: 'Comma-separated excluded keywords' },
    { name: 'company-sizes', type: 'string', default: '', help: 'Comma-separated company size labels' },
    { name: 'stages', type: 'string', default: '', help: 'Comma-separated investment stage labels' },
    { name: 'mostly-remote', type: 'boolean', help: 'Only show companies that are mostly or fully remote' },
    { name: 'responsive', type: 'boolean', help: 'Only show highly responsive companies' },
    { name: 'visa', type: 'boolean', help: 'Only show companies that can sponsor a visa' },
    { name: 'hide-company-apply', type: 'boolean', help: 'Document desired setting for hiding company-website applications; current UI exposes this outside the modal' },
    { name: 'execute', type: 'boolean', default: false, help: 'Actually update filters. Without it, this reads current filters and previews requested changes.' },
  ],
  columns: FILTER_COLUMNS,
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for wellfound filters');
    const execute = parseBoolean(args.execute, false);
    const config = buildFilterConfig(args);

    await page.goto(buildJobsUrl(args));
    await page.wait(4);
    await assertAuthenticated(page, 'wellfound filters');

    const opened = unwrapEvaluateResult(await page.evaluate(buildOpenFiltersScript()));
    if (!opened?.opened) {
      throw new CommandExecutionError(`wellfound filters could not open the filters dialog: ${opened?.reason || 'unknown reason'}`);
    }

    if (!execute) {
      const notes = config.usePreset
        ? 'dry-run; ai-fullstack-remote preset prepared but not applied'
        : 'dry-run; pass --execute to update filters';
      return [normalizeFilterState(unwrapEvaluateResult(await page.evaluate(buildFilterInspectionScript('dry-run', notes))))];
    }

    const update = unwrapEvaluateResult(await page.evaluate(buildFilterUpdateScript(config)));
    if (!update?.ok) {
      throw new CommandExecutionError(`wellfound filters update failed: ${update?.notes || 'unknown reason'}`);
    }
    const unsupported = Array.isArray(update.unsupported) && update.unsupported.length
      ? `Unsupported controls: ${update.unsupported.join(', ')}`
      : 'Filters updated';
    return [normalizeFilterState(unwrapEvaluateResult(await page.evaluate(buildFilterInspectionScript('updated', unsupported))))];
  },
});
