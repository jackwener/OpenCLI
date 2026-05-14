import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { createHash } from 'node:crypto';
import { clampInt } from '../_shared/common.js';

function buildSignedUrl(limit, since, slug) {
  var params = {
    limit: String(limit),
    latest_updated_at: String(since != null ? since : 0),
    tz: '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
  if (slug) params.latest_slug = slug;
  var keys = Object.keys(params).sort();
  var s = keys.map(function(k) { return k + '=' + params[k]; }).join('&');
  params.sign = createHash('md5').update(s + 'dbbc3dd73364b4084c3a69346e0ce2b2').digest('hex');
  return 'https://flomoapp.com/api/v1/memo/updated/?' + new URLSearchParams(params).toString();
}

function buildGetTokenJs() {
  return '(function(){try{var m=JSON.parse(localStorage.getItem("me"));return m&&m.access_token?m.access_token:null;}catch(e){return null;}})()';
}

var command = cli({
  site: 'flomo',
  name: 'memos',
  access: 'read',
  description: 'List your Flomo memos',
  domain: 'flomoapp.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: 'https://v.flomoapp.com/',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of memos (max 200). Use --limit 200 to fetch all' },
    { name: 'since', type: 'int', help: 'Only memos updated after this Unix timestamp (e.g. 1735689600 for 2025)' },
    { name: 'slug', help: '[Experimental] Pagination cursor from previous response' },
  ],
  columns: ['content', 'slug', 'tags', 'images', 'created_at', 'updated_at'],
  func: async function(page, kwargs) {
    var limit = clampInt(kwargs.limit, 20, 1, 200);
    await page.wait(3).catch(function() {});
    var token = await page.evaluate(buildGetTokenJs());
    if (!token) {
      throw new CliError('AUTH_REQUIRED', 'Not logged in to Flomo', 'Open https://v.flomoapp.com in this browser and log in first');
    }
    var url = buildSignedUrl(limit, kwargs.since, kwargs.slug);
    var resp;
    try {
      resp = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
    } catch (err) {
      throw new CliError('NETWORK_ERROR', 'Failed to fetch memos: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (!resp.ok) {
      throw new CliError('HTTP_ERROR', 'API returned ' + resp.status);
    }
    var body;
    try {
      body = await resp.json();
    } catch (_) {
      throw new CliError('PARSE_ERROR', 'Failed to parse API response');
    }
    if (body.code !== 0) {
      throw new CliError('API_ERROR', body.message || 'API error code ' + body.code);
    }
    var memos = Array.isArray(body.data) ? body.data : [];
    return memos.map(function(m) {
      var images = Array.isArray(m.files) ? m.files.map(function(f) { return f.thumbnail_url || f.url || ''; }).filter(Boolean) : [];
      return {
        content: (m.content || '').trim(),
        slug: m.slug || '',
        tags: Array.isArray(m.tags) ? m.tags.join(', ') : '',
        images: images.join(' | '),
        created_at: m.created_at || '',
        updated_at: m.updated_at || '',
      };
    });
  },
});

export var __test__ = { command: command };
