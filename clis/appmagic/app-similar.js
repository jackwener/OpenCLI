// appmagic app-similar — the app page's "Similar apps" widget.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/similarity/app-info with
// {"id": "<storeAppId>"} — the id is a BARE STRING, not an object or an array
// (bundle chunk-DJDumY0p.js @1253: `getWidgetData(e){return
// this.http.post(i.AppInfoUrl,{id:e})}`). Replays 200 + JSON with 10 nodes, no
// auth. Note this endpoint takes no store code: the id alone identifies the app.
//
// Not exposed here: the "Similarity Graph" button behind it, POST
// /api/v2/similarity {id, country}, which is 403 anonymously — premium.
// The related POST /api/v2/similarity/countries {id} IS public and returns the
// countries the similarity model covers; it is not surfaced because it answers
// a different question than "which apps are similar".
//
// `depth` is the site's own min_depth: 1 = directly similar, 2 = similar to a
// similar app. The UI drops depth 0 (that is the queried app itself) and sorts
// by score descending — this adapter does the same so the row order matches
// the icon order on the page.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { decodeBucket, DOMAIN, normalizeLimit, postJson } from './utils.js';

const MAX_LIMIT = 50;

cli({
  site: 'appmagic',
  name: 'app-similar',
  description: 'Apps similar to a given app, ranked by similarity score. Downloads are bucketed over the trailing 30 days',
  access: 'read',
  example: 'opencli appmagic app-similar com.ig.wool.rescue',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. com.ig.wool.rescue or 447188370' },
    { name: 'limit', type: 'int', default: 20, help: `Number of similar apps (max ${MAX_LIMIT})` },
  ],
  columns: ['rank', 'name', 'publisher', 'score', 'depth', 'downloadsMin', 'downloadsMax', 'unitedId'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');
    const limit = normalizeLimit(args.limit, 20, MAX_LIMIT);

    const payload = await postJson('/similarity/app-info', { id: appId }, 'app-similar');
    const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];

    // min_depth === 0 is the queried app itself, not a similar app.
    const similar = nodes
      .filter((n) => n?.min_depth !== 0)
      .sort((a, b) => (b?.sum_score ?? 0) - (a?.sum_score ?? 0));

    if (similar.length === 0) {
      throw new EmptyResultError('appmagic app-similar', `no similar apps for ${appId}`);
    }

    return similar.slice(0, limit).map((node, i) => {
      const app = node?.app;
      const downloads = decodeBucket(app?.downloads);
      return {
        rank: i + 1,
        name: app?.name ?? null,
        publisher: app?.unitedPublisher?.name || app?.publisher_name || null,
        score: node?.sum_score ?? null,
        depth: node?.min_depth ?? null,
        downloadsMin: downloads.min,
        downloadsMax: downloads.max,
        unitedId: app?.id != null ? String(app.id) : null,
      };
    });
  },
});
