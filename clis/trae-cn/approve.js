import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  approveTraePrompts,
  normalizeApprovalKinds,
  normalizeApprovalLimit,
  normalizeMaxChars,
} from './utils.js';

function normalizeDryRun(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

export const approveCommand = cli({
  site: 'trae-cn',
  name: 'approve',
  access: 'write',
  description: 'Approve visible Trae CN permission prompts such as terminal-run, high-risk command, or delete confirmations',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn approve --approve-kinds terminal,delete -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'approve-kinds', type: 'string', required: false, help: 'Comma-separated approval categories: terminal,delete,keep,all (default: terminal,delete; keep is not default)', default: 'terminal,delete' },
    { name: 'limit', type: 'int', required: false, help: 'Max visible prompts to approve in this pass (default: 1)', default: 1 },
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars to return from prompt text; 0 returns full text (default: 600)', default: 600 },
    { name: 'dry-run', type: 'boolean', required: false, help: 'Detect matching prompts without clicking them (default: false)', default: false },
  ],
  columns: ['Status', 'Kind', 'Button', 'Prompt', 'Selector', 'Action'],
  func: async (page, kwargs) => {
    const kinds = normalizeApprovalKinds(kwargs['approve-kinds']);
    const limit = normalizeApprovalLimit(kwargs.limit, 1);
    const maxChars = normalizeMaxChars(kwargs['max-chars'], 600);
    const dryRun = normalizeDryRun(kwargs['dry-run']);
    const rows = await approveTraePrompts(page, kinds, { click: !dryRun, limit, maxChars });
    if (!dryRun && rows.some(row => row.Action && String(row.Action).startsWith('click-failed'))) {
      const failed = rows.find(row => row.Action && String(row.Action).startsWith('click-failed'));
      throw new CommandExecutionError(`Trae CN approval click failed: ${failed?.Action || 'unknown error'}`);
    }
    if (rows.length === 0) {
      return [{
        Status: 'NoPrompt',
        Kind: kinds.join(','),
        Button: '',
        Prompt: 'No matching visible Trae CN approval prompt found',
        Selector: '',
        Action: dryRun ? 'dry-run' : 'none',
      }];
    }
    return rows;
  },
});
