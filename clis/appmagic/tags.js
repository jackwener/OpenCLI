// appmagic tags — the tag taxonomy that `top-charts --tag` filters on.
//
// Strategy: PUBLIC_API. Contract: stable. GET /api/v2/tags replays 200 + JSON
// with the full 1494-tag catalog, no auth. See utils.js for the full note.
//
// The endpoint has no server-side search or paging — it returns the whole
// catalog every call — so --query and --type filter client-side.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, getJson, normalizeLimit } from './utils.js';

const MAX_LIMIT = 500;

cli({
  site: 'appmagic',
  name: 'tags',
  description: 'Tag taxonomy (games / apps / themes / ip / features ...). Use a tag id or name with top-charts --tag',
  access: 'read',
  example: 'opencli appmagic tags --query messenger',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', type: 'string', default: '', help: 'Filter by name substring, case-insensitive' },
    { name: 'type', type: 'string', default: '', help: 'Filter by type: games / apps / themes / ip / features / settings / artstyles / meta / complexity / domain' },
    { name: 'limit', type: 'int', default: 50, help: `Number of tags (max ${MAX_LIMIT})` },
  ],
  columns: ['id', 'name', 'type', 'parentIds'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 50, MAX_LIMIT);
    const query = String(args.query ?? '').trim().toLowerCase();
    const type = String(args.type ?? '').trim().toLowerCase();

    const payload = await getJson('/tags', {}, 'tags');
    let all = Array.isArray(payload?.data) ? payload.data : [];
    if (all.length === 0) throw new EmptyResultError('appmagic tags', 'tag catalog is empty');

    if (query !== '') all = all.filter((t) => String(t?.name ?? '').toLowerCase().includes(query));
    if (type !== '') all = all.filter((t) => String(t?.type ?? '').toLowerCase() === type);

    if (all.length === 0) {
      const filters = [query && `query "${query}"`, type && `type "${type}"`].filter(Boolean).join(' + ');
      throw new EmptyResultError('appmagic tags', `no tag matches ${filters}`);
    }

    return all.slice(0, limit).map((t) => ({
      id: t?.id ?? null,
      name: t?.name ?? null,
      type: t?.type ?? null,
      // parent_ids is a '-'-joined string of tag ids; '' means a root tag.
      parentIds: String(t?.parent_ids ?? '') || null,
    }));
  },
});
