import { CDPBridge } from '@jackwener/opencli/browser/cdp';
import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { activityScript } from './utils.js';

function normalizeEndpoint(value) {
  const endpoint = String(value || process.env.OPENCLI_CDP_ENDPOINT || 'http://127.0.0.1:39240').trim();
  if (!endpoint) {
    throw new ArgumentError('Set OPENCLI_CDP_ENDPOINT, for example http://127.0.0.1:39240');
  }
  return endpoint.replace(/\/$/, '');
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value === true || String(value).toLowerCase() === 'true';
}

function targetValue(target) {
  const title = String(target?.title || '').trim();
  const workspace = title.match(/—\s*(.+)$/)?.[1]?.trim();
  return workspace || title || String(target?.url || '').trim();
}

function matchesTarget(target, wanted) {
  if (!wanted) return false;
  const needle = String(wanted).toLowerCase();
  const haystack = `${target.title || ''} ${target.url || ''}`.toLowerCase();
  return haystack.includes(needle);
}

async function fetchTargets(endpoint) {
  const response = await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch CDP targets: HTTP ${response.status}`);
  }
  const targets = await response.json();
  return Array.isArray(targets) ? targets : [];
}

async function probeTargetActivity(target, maxChars) {
  if (!target.webSocketDebuggerUrl) return null;
  const bridge = new CDPBridge();
  try {
    const page = await bridge.connect({ cdpEndpoint: target.webSocketDebuggerUrl, timeout: 3, surface: 'adapter' });
    return await page.evaluate(activityScript(maxChars));
  } catch {
    return null;
  } finally {
    await bridge.close().catch(() => {});
  }
}

export const targetsCommand = cli({
  site: 'trae-cn',
  name: 'targets',
  access: 'read',
  description: 'List Trae CN CDP targets and show which workspace/window is waiting',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 opencli trae-cn targets -f table',
  strategy: Strategy.LOCAL,
  browser: false,
  args: [
    { name: 'endpoint', type: 'string', required: false, help: 'CDP endpoint (default: OPENCLI_CDP_ENDPOINT)' },
    { name: 'probe-activity', type: 'boolean', required: false, help: 'Probe each target for Trae activity state (default: true)', default: true },
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars for approval prompt/activity snippets (default: 240)', default: 240 },
  ],
  columns: ['Index', 'SelectedHint', 'RecommendedTarget', 'Title', 'Workspace', 'Status', 'ApprovalPending', 'ApprovalKind', 'ApprovalButton', 'Model', 'Agent', 'Type', 'Url'],
  func: async (kwargs) => {
    const endpoint = normalizeEndpoint(kwargs.endpoint);
    const probe = normalizeBoolean(kwargs['probe-activity'], true);
    const maxChars = Number.isInteger(Number(kwargs['max-chars'])) ? Number(kwargs['max-chars']) : 240;
    const wanted = process.env.OPENCLI_CDP_TARGET || '';
    const targets = (await fetchTargets(endpoint)).filter(target => target.webSocketDebuggerUrl && target.type !== 'worker');
    const rows = [];

    for (const [index, target] of targets.entries()) {
      const activity = probe ? await probeTargetActivity(target, maxChars) : null;
      rows.push({
        Index: index,
        SelectedHint: wanted ? (matchesTarget(target, wanted) ? 'yes' : 'no') : (index === 0 ? 'default' : ''),
        RecommendedTarget: targetValue(target),
        Title: target.title || '',
        Workspace: activity?.Workspace || target.title?.match(/—\s*(.+)$/)?.[1]?.trim() || '',
        Status: activity?.Status || '',
        ApprovalPending: activity?.ApprovalPending || '',
        ApprovalKind: activity?.ApprovalKind || '',
        ApprovalButton: activity?.ApprovalButton || '',
        Model: activity?.Model || '',
        Agent: activity?.Agent || '',
        Type: target.type || '',
        Url: target.url || '',
      });
    }
    return rows;
  },
});
