import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { createHash } from 'node:crypto';

function signParams(params, secret) {
  var keys = Object.keys(params).sort();
  var s = keys.map(function(k) { return k + '=' + params[k]; }).join('&');
  return createHash('md5').update(s + secret).digest('hex');
}

function buildUrl(limit, slug, updatedAt, tz) {
  var params = {
    limit: String(limit),
    latest_updated_at: String(updatedAt != null ? updatedAt : 0),
    tz: tz || '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
  if (slug) params.latest_slug = slug;
  var secret = 'dbbc3dd73364b4084c3a69346e0ce2b2';
  params.sign = signParams(params, secret);
  return 'https://flomoapp.com/api/v1/memo/updated/?' + new URLSearchParams(params).toString();
}

var command = cli({
  site: 'flomo',
  name: 'memos',
  access: 'read',
  description: 'List your Flomo memos',
  domain: 'flomoapp.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of memos to fetch (max 200)' },
    { name: 'slug', help: 'Pagination cursor: slug of the last memo from previous page' },
    { name: 'tz', default: '8:0', help: 'Timezone offset (e.g. 8:0 for Beijing)' },
  ],
  columns: ['content', 'slug', 'tags', 'created_at', 'updated_at'],
  func: async function(kwargs) {
    var limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 200));
    var token = process.env.FLOMO_ACCESS_TOKEN || '';
    if (!token) {
      throw new CliError('AUTH_REQUIRED', 'FLOMO_ACCESS_TOKEN is not set', 'Set the FLOMO_ACCESS_TOKEN environment variable. You can find your token in the browser DevTools > Application > Local Storage > flomoapp.com > flomo_token');
    }
    var url = buildUrl(limit, kwargs.slug, null, kwargs.tz);
    var resp;
    try {
      resp = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://flomoapp.com/',
          'Accept': 'application/json',
        },
      });
    } catch (err) {
      throw new CliError('NETWORK_ERROR', 'Failed to fetch memos: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (!resp.ok) {
      throw new CliError('HTTP_ERROR', 'API returned ' + resp.status + ' ' + resp.statusText);
    }
    var body;
    try {
      body = await resp.json();
    } catch (_) {
      throw new CliError('PARSE_ERROR', 'Failed to parse API response');
    }
    if (body.code !== 0) {
      throw new CliError('API_ERROR', 'API error: ' + (body.message || 'code ' + body.code));
    }
    var memos = Array.isArray(body.data) ? body.data : [];
    return memos.map(function(m) {
      return {
        content: (m.content || '').trim(),
        slug: m.slug || '',
        tags: Array.isArray(m.tags) ? m.tags.join(', ') : '',
        created_at: m.created_at || '',
        updated_at: m.updated_at || '',
      };
    });
  },
});

export var __test__ = { command: command };
