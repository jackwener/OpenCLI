import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  APPLY_COLUMNS,
  assertAuthenticated,
  assertExpectedApplyTarget,
  buildApplyInspectionScript,
  buildApplySubmitScript,
  buildDetailUrl,
  normalizeApplyMessage,
  normalizeApplyState,
  normalizeJobSlug,
  parseBoolean,
  unwrapEvaluateResult,
} from './utils.js';

cli({
  site: 'wellfound',
  name: 'apply',
  access: 'write',
  description: 'Inspect or submit a Wellfound-native job application; external company applications are detected and not submitted by default',
  domain: 'wellfound.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'job-url', type: 'string', required: true, positional: true, help: 'Wellfound /jobs/<id-slug> URL, ?job_listing_slug URL, or raw id-slug' },
    { name: 'message', type: 'string', default: '', help: 'Answer for "What interests you about working for this company?"' },
    { name: 'expected-title', type: 'string', default: '', help: 'Guard: refuse if the opened job title differs' },
    { name: 'expected-company', type: 'string', default: '', help: 'Guard: refuse if the opened company differs' },
    { name: 'allow-company-website', type: 'boolean', default: false, help: 'Return external apply URLs as allowed instead of blocked; does not submit external forms' },
    { name: 'execute', type: 'boolean', default: false, help: 'Actually click the Wellfound Apply button. Without it, this is a dry-run inspection.' },
  ],
  columns: APPLY_COLUMNS,
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for wellfound apply');
    const slug = normalizeJobSlug(args['job-url']);
    const message = normalizeApplyMessage(args.message);
    const execute = parseBoolean(args.execute, false);
    const allowCompanyWebsite = parseBoolean(args['allow-company-website'], false);

    await page.goto(buildDetailUrl(slug));
    await page.wait(4);
    await assertAuthenticated(page, 'wellfound apply');

    const state = normalizeApplyState(unwrapEvaluateResult(await page.evaluate(buildApplyInspectionScript(message))));
    assertExpectedApplyTarget(state, args['expected-title'], args['expected-company']);

    if (state.apply_mode === 'company_website') {
      return [{
        ...state,
        status: allowCompanyWebsite ? 'external_allowed' : 'external_blocked',
        notes: allowCompanyWebsite
          ? 'External company application detected; OpenCLI did not submit the external form'
          : 'External company application detected; pass --allow-company-website to treat the URL as an allowed handoff',
      }];
    }

    if (state.apply_mode === 'already_applied') return [state];
    if (state.apply_mode !== 'wellfound') {
      return [{ ...state, status: 'not_applicable', notes: 'No Wellfound-native apply form was detected' }];
    }

    if (!execute) {
      return [{ ...state, status: 'dry-run', notes: 'Pass --execute to submit the Wellfound-native application' }];
    }
    if (!message) {
      throw new ArgumentError('wellfound apply requires --message when --execute is used');
    }

    const submit = unwrapEvaluateResult(await page.evaluate(buildApplySubmitScript(message)));
    const after = normalizeApplyState(unwrapEvaluateResult(await page.evaluate(buildApplyInspectionScript(message))));
    return [{
      ...after,
      status: submit?.status || after.status,
      message_filled: submit?.message_filled || after.message_filled,
      message_length: submit?.message_length === undefined ? after.message_length : String(submit.message_length),
      notes: submit?.notes || after.notes,
    }];
  },
});
