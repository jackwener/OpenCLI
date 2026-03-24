/**
 * YAML candidate generation from recorded API requests.
 */

import {
  VOLATILE_PARAMS,
  SEARCH_PARAMS,
  PAGINATION_PARAMS,
  FIELD_ROLES,
} from '../constants.js';
import type { RecordedRequest } from './types.js';
import { inferStrategy, findArrayPath } from './analysis.js';

/**
 * Build a YAML candidate from a recorded request and its analysis results.
 */
export function buildRecordedYaml(
  site: string,
  pageUrl: string,
  req: RecordedRequest,
  capName: string,
  arrayResult: ReturnType<typeof findArrayPath>,
  authIndicators: string[],
): { name: string; yaml: unknown } {
  const strategy = inferStrategy(authIndicators);
  const domain = (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })();

  // Detect fields from first array item
  const detectedFields: Record<string, string> = {};
  if (arrayResult?.items[0] && typeof arrayResult.items[0] === 'object') {
    const sampleKeys = Object.keys(arrayResult.items[0] as object).map(k => k.toLowerCase());
    for (const [role, aliases] of Object.entries(FIELD_ROLES)) {
      const match = aliases.find(a => sampleKeys.includes(a));
      if (match) detectedFields[role] = match;
    }
  }

  const itemPath = arrayResult?.path ?? null;
  // When path is '' (root-level array), access data directly; otherwise chain with optional chaining
  const pathChain = itemPath === null
    ? ''
    : itemPath === ''
      ? ''
      : itemPath.split('.').map(p => `?.${p}`).join('');

  // Detect search/limit/page params
  const qp: string[] = [];
  try { new URL(req.url).searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) qp.push(k); }); } catch {}
  const hasSearch = qp.some(p => SEARCH_PARAMS.has(p));
  const hasPage = qp.some(p => PAGINATION_PARAMS.has(p));

  // Build evaluate script
  const mapLines = Object.entries(detectedFields)
    .map(([role, field]) => `          ${role}: item?.${field}`)
    .join(',\n');
  const mapExpr = mapLines
    ? `.map(item => ({\n${mapLines}\n        }))`
    : '';

  // Build fetch URL — for search/page args, replace query param values with template vars
  let fetchUrl = req.url;
  try {
    const u = new URL(req.url);
    if (hasSearch) {
      for (const p of SEARCH_PARAMS) {
        if (u.searchParams.has(p)) { u.searchParams.set(p, '{{args.keyword}}'); break; }
      }
    }
    if (hasPage) {
      for (const p of PAGINATION_PARAMS) {
        if (u.searchParams.has(p)) { u.searchParams.set(p, '{{args.page | default(1)}}'); break; }
      }
    }
    fetchUrl = u.toString();
  } catch {}

  // When itemPath is empty, the array IS the response root; otherwise chain with ?.
  const dataAccess = pathChain ? `data${pathChain}` : 'data';

  const evaluateScript = [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(fetchUrl)}, { credentials: 'include' });`,
    '  const data = await res.json();',
    `  return (${dataAccess} || [])${mapExpr};`,
    '})()',
  ].join('\n');

  const args: Record<string, unknown> = {};
  if (hasSearch) args['keyword'] = { type: 'str', required: true, description: 'Search keyword', positional: true };
  args['limit'] = { type: 'int', default: 20, description: 'Number of items' };
  if (hasPage) args['page'] = { type: 'int', default: 1, description: 'Page number' };

  const columns = ['rank', ...Object.keys(detectedFields).length ? Object.keys(detectedFields) : ['title', 'url']];

  const mapStep: Record<string, string> = { rank: '${{ index + 1 }}' };
  for (const col of columns.filter(c => c !== 'rank')) {
    mapStep[col] = `\${{ item.${col} }}`;
  }

  const pipeline: unknown[] = [
    { navigate: pageUrl },
    { evaluate: evaluateScript },
    { map: mapStep },
    { limit: '${{ args.limit | default(20) }}' },
  ];

  return {
    name: capName,
    yaml: {
      site,
      name: capName,
      description: `${site} ${capName} (recorded)`,
      domain,
      strategy,
      browser: true,
      args,
      pipeline,
      columns,
    },
  };
}
