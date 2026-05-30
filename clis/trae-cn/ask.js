import { cli, Strategy } from '@jackwener/opencli/registry';
import { TimeoutError } from '@jackwener/opencli/errors';
import {
  activityScript,
  approveTraePrompts,
  isActivityComplete,
  isLikelyBlockingActivity,
  latestAssistantScript,
  normalizeApprovalKinds,
  normalizeMaxChars,
  normalizeTimeout,
  sendTraePrompt,
} from './utils.js';

function normalizeAutoApprove(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

export const askCommand = cli({
  site: 'trae-cn',
  name: 'ask',
  access: 'write',
  description: 'Send a prompt to Trae CN, wait for the assistant result without treating approval cards as final, and return it',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn ask "请只回复 OK" --timeout 120 -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send into Trae CN' },
    { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait for response (default: 60)', default: 60 },
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars to return from the assistant response; 0 returns full text (default: 12000)', default: 12000 },
    { name: 'auto-approve', type: 'boolean', required: false, help: 'While waiting, approve visible terminal/delete prompts, including high-risk terminal confirmation layers (default: false)', default: false },
    { name: 'approve-kinds', type: 'string', required: false, help: 'Comma-separated approval categories for --auto-approve: terminal,delete,keep,all (default: terminal,delete; keep is not default)', default: 'terminal,delete' },
  ],
  columns: ['Role', 'Text', 'TextChars', 'Truncated', 'TurnIndex', 'MessageId'],
  func: async (page, kwargs) => {
    const timeout = normalizeTimeout(kwargs.timeout, 60);
    const maxChars = normalizeMaxChars(kwargs['max-chars'], 12000);
    const autoApprove = normalizeAutoApprove(kwargs['auto-approve']);
    const approvalKinds = normalizeApprovalKinds(kwargs['approve-kinds']);
    const beforeAssistant = await page.evaluate(latestAssistantScript(0));
    const beforeKey = [
      beforeAssistant?.MessageId || '',
      beforeAssistant?.TurnIndex || '',
      beforeAssistant?.Text || '',
    ].join('|');
    await sendTraePrompt(page, kwargs.text);

    const deadline = Date.now() + timeout * 1000;
    let lastText = '';
    let stableSince = 0;
    let latest = null;
    let latestActivity = null;

    while (Date.now() < deadline) {
      await page.wait(2);
      if (autoApprove) {
        await approveTraePrompts(page, approvalKinds, { click: true, limit: 1, maxChars: 600 });
      }
      latest = await page.evaluate(latestAssistantScript(maxChars));
      latestActivity = await page.evaluate(activityScript(600));
      const text = latest?.Text?.trim() || '';
      if (!text) continue;
      const latestKey = [
        latest?.MessageId || '',
        latest?.TurnIndex || '',
        latest?.Text || '',
      ].join('|');
      if (latestKey === beforeKey) continue;
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
        continue;
      }
      const stableFor = Date.now() - stableSince;
      const blocked = isLikelyBlockingActivity(latestActivity);
      const completed = isActivityComplete(latestActivity);
      if (completed && !blocked && stableFor >= 1000) {
        return [latest];
      }
      if (!blocked && stableFor >= 3000) {
        return [latest];
      }
    }

    if (latest?.Text) {
      const blocked = isLikelyBlockingActivity(latestActivity);
      if (blocked) {
        throw new TimeoutError(
          'trae-cn ask',
          timeout,
          `Current status=${latestActivity?.Status ?? ''}, approvalPending=${latestActivity?.ApprovalPending ?? ''}, approvalKind=${latestActivity?.ApprovalKind ?? ''}, approvalButton=${latestActivity?.ApprovalButton ?? ''}. Use "opencli trae-cn targets -f json" to find the waiting target, then run "OPENCLI_CDP_TARGET=<target> opencli trae-cn watch --stream true --duration 300" or "opencli trae-cn approve".`,
        );
      }
      return [latest];
    }
    throw new TimeoutError('trae-cn ask', timeout, 'No Trae CN response was visible before the timeout. The agent may still be generating.');
  },
});
