import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  activityScript,
  approveTraePrompts,
  normalizeApprovalKinds,
  normalizeDuration,
  normalizeInterval,
  normalizeMaxChars,
} from './utils.js';

function signature(row) {
  return [
    row.Status || '',
    row.MessageId || '',
    row.TurnIndex || '',
    row.Progress || '',
    row.ActiveStep || '',
    row.ApprovalPending || '',
    row.ApprovalKind || '',
    row.ApprovalButton || '',
    row.TextChars ?? '',
    row.LatestText || '',
  ].join('|');
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function normalizeStream(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function normalizeStopOnComplete(value) {
  return value === undefined || value === true || String(value).toLowerCase() === 'true';
}

function normalizeAutoApprove(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

export const watchCommand = cli({
  site: 'trae-cn',
  name: 'watch',
  access: 'write',
  description: 'Sample Trae CN activity over time to monitor long-running tasks; optionally approve visible terminal/delete prompts',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn watch --stream true --duration 120',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'duration', type: 'int', required: false, help: 'Seconds to observe (default: 30)', default: 30 },
    { name: 'interval', type: 'int', required: false, help: 'Seconds between samples (default: 2)', default: 2 },
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars per text field; 0 returns full text (default: 600)', default: 600 },
    { name: 'timeout', type: 'int', required: false, help: 'Max seconds for the overall watch command (default: 86400)', default: 86400 },
    { name: 'stream', type: 'boolean', required: false, help: 'Write each sample immediately as JSONL and skip result rendering (default: false)', default: false },
    { name: 'stop-on-complete', type: 'boolean', required: false, help: 'Stop watching after the first completed sample (default: true)', default: true },
    { name: 'auto-approve', type: 'boolean', required: false, help: 'Approve visible terminal/delete prompts before each sample, including high-risk terminal confirmation layers (default: false)', default: false },
    { name: 'approve-kinds', type: 'string', required: false, help: 'Comma-separated approval categories for --auto-approve: terminal,delete,keep,all (default: terminal,delete; keep is not default)', default: 'terminal,delete' },
  ],
  columns: ['Sample', 'ElapsedSec', 'Changed', 'Status', 'Progress', 'ActiveStep', 'ApprovalPending', 'ApprovalKind', 'ApprovalButton', 'AutoApproved', 'LatestRole', 'TurnIndex', 'MessageId', 'TextChars', 'LatestText', 'UpdatedAt'],
  func: async (page, kwargs) => {
    const duration = normalizeDuration(kwargs.duration, 30);
    const interval = normalizeInterval(kwargs.interval, 2);
    const maxChars = normalizeMaxChars(kwargs['max-chars'], 600);
    const stream = normalizeStream(kwargs.stream);
    const stopOnComplete = normalizeStopOnComplete(kwargs['stop-on-complete']);
    const autoApprove = normalizeAutoApprove(kwargs['auto-approve']);
    const approvalKinds = normalizeApprovalKinds(kwargs['approve-kinds']);
    const started = Date.now();
    const deadline = started + duration * 1000;
    const rows = [];
    let previous = '';
    let sample = 0;

    while (Date.now() <= deadline || sample === 0) {
      const approved = autoApprove
        ? await approveTraePrompts(page, approvalKinds, { click: true, limit: 1, maxChars: 300 })
        : [];
      if (approved.length > 0) {
        await sleep(0.5);
      }
      const activity = await page.evaluate(activityScript(maxChars));
      const current = signature(activity);
      const row = {
        Sample: ++sample,
        ElapsedSec: Math.round((Date.now() - started) / 1000),
        Changed: previous && previous !== current ? 'yes' : sample === 1 ? 'initial' : 'no',
        Status: activity.Status,
        Progress: activity.Progress,
        ActiveStep: activity.ActiveStep,
        ApprovalPending: activity.ApprovalPending,
        ApprovalKind: activity.ApprovalKind,
        ApprovalButton: activity.ApprovalButton,
        AutoApproved: approved
          .filter(item => item.Status === 'Approved' || item.Action === 'clicked')
          .map(item => `${item.Kind}:${item.Button}`)
          .join('\n'),
        LatestRole: activity.LatestRole,
        TurnIndex: activity.TurnIndex,
        MessageId: activity.MessageId,
        TextChars: activity.TextChars,
        LatestText: activity.LatestText,
        UpdatedAt: activity.UpdatedAt,
      };
      if (stream) {
        process.stdout.write(`${JSON.stringify(row)}\n`);
      } else {
        rows.push(row);
      }
      previous = current;
      if (stopOnComplete && activity.Status === 'completed') break;
      if (Date.now() + interval * 1000 > deadline) break;
      await sleep(interval);
    }

    return stream ? null : rows;
  },
});
