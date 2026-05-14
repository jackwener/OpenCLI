import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { createHash } from 'node:crypto';

function buildSignedUrl(limit, slug) {
  var params = {
    limit: String(limit),
    latest_updated_at: '0',
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

function buildTokenCheckJs() {
  return '(function(){var t=window.localStorage.getItem("flomo_token");return t?{ok:true}:{ok:false};})()';
}

function buildFetchJs(url) {
  return (
    '(function(){try{' +
    'var tkn=window.localStorage.getItem("flomo_token");' +
    'if(!tkn)return{error:"no_token"};' +
    'return fetch("' + url + '",{' +
    'headers:{"Authorization":"Bearer "+tkn,"Accept":"application/json"}' +
    '}).then(function(r){return r.json();}).then(function(j){' +
    'if(j.code!==0)return{error:j.message||"err_"+j.code};' +
    'return{items:j.data||[]};' +
    '});}catch(e){return Promise.resolve({error:e.message});}})()'
  );
}

var command = cli({
  site: 'flomo',
  name: 'memos',
  access: 'read',
  description: 'List your Flomo memos',
  domain: 'flomoapp.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: 'https://flomoapp.com/mine',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of memos to fetch (max 200)' },
    { name: 'slug', help: 'Pagination cursor: slug of the last memo from previous page' },
  ],
  columns: ['content', 'slug', 'tags', 'created_at', 'updated_at'],
  func: async function(page, kwargs) {
    var limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 200));
    await page.wait(3).catch(function() {});
    var check = await page.evaluate(buildTokenCheckJs());
    if (!check || !check.ok) {
      throw new CliError('AUTH_REQUIRED', 'Not logged in to Flomo', 'Open https://flomoapp.com in your browser, log in, then run this command again');
    }
    var url = buildSignedUrl(limit, kwargs.slug);
    var data = await page.evaluate(buildFetchJs(url));
    if (!data || data.error) {
      throw new CliError('API_ERROR', 'Failed to fetch memos: ' + ((data && data.error) || 'unknown'));
    }
    var memos = Array.isArray(data.items) ? data.items : [];
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
