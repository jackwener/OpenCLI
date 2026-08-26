/**
 * CDP Gold Fixture Fetcher (v4 — uses Target.attachToTarget)
 *
 * Crawls multiple search queries via CDP and saves:
 *   - evaluate-output.json (golden expected)
 *   - cards.html (raw outerHTML)
 *   - container-info.json (parent class + attributes)
 *   - page.json (metadata)
 *
 * Usage: node clis/zlibrary-app/scripts/fetch-fixtures.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';

const FIXTURES_DIR = resolve(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'zlibrary-app');

const version = await fetch('http://localhost:9230/json/version').then(r => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); });

let msgId = 0;
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    const handler = data => {
      const r = JSON.parse(data.toString());
      if (r.id === id) { ws.off('message', handler); r.error ? reject(Error(r.error.message)) : resolve(r); }
    };
    ws.on('message', handler);
    setTimeout(() => reject(Error(`Timeout: ${method}`)), 15000);
  });
}

// Get target + attach to search page
const targets = (await send('Target.getTargets')).result.targetInfos;
const searchTarget = targets.find(t => t.url?.includes('/s/') && !t.url?.includes('/login'));
if (!searchTarget) { console.error('No search page. Navigate to a search result first.'); process.exit(1); }
console.log(`Target: ${searchTarget.title}`);
const attach = await send('Target.attachToTarget', { targetId: searchTarget.targetId, flatten: true });
const sid = attach.result.sessionId;
console.log('Attached, session:', sid);

// Wait helper
await send('Runtime.evaluate', {
  expression: `new Promise(r => setTimeout(r, 500))`,
  awaitPromise: true,
}, sid);

// Navigate and wait for page
async function nav(url) {
  await send('Page.navigate', { url }, sid);
  await send('Runtime.evaluate', {
    expression: `new Promise(r => setTimeout(r, 3000))`,
    awaitPromise: true,
  }, sid);
}

// Extract all data from current page
async function extract() {
  const info = (await send('Runtime.evaluate', {
    expression: `({url:location.href, title:document.title, cardCount:document.querySelectorAll('z-bookcard').length, hasNext:!!document.querySelector('a[rel="next"]')})`,
    returnByValue: true,
  }, sid)).result.result.value;

  const output = (await send('Runtime.evaluate', {
    expression: `
      Array.from(document.querySelectorAll('z-bookcard')).slice(0,50).map(function(c,i){
        var t=(c.textContent||'').trim().split('\\n').map(function(l){return l.trim()}).filter(Boolean);
        var y=c.getAttribute('year')||(t.find(function(l){return/^(19\\d{2}|20[0-2]\\d)$/.test(l)})||'');
        var pc=''; try{pc=c.parentElement.className||'';}catch(e){}
        var ct=c.getAttribute('data-type')||(pc.includes('resItemBoxBooks')?'book':pc.includes('resItemBoxArticles')?'article':'');
        var abs=function(h){if(!h)return'';try{var p=new URL(h,window.location.href);if(p.origin!==window.location.origin)return'';return p.href;}catch(e){return h.startsWith('/')?window.location.origin+h:'';}};
        var url=''; try{if(c.shadowRoot){var a=c.shadowRoot.querySelector('a');if(a)url=abs(a.href||'');}}catch(e){} if(!url)url=abs(c.getAttribute('href')||'');
        return {rank:i+1,title:t[0]||'',author:t[1]||'',year:y,language:c.getAttribute('language')||'',extension:c.getAttribute('extension')||'',contentType:ct,size:c.getAttribute('filesize')||'',url:url,id:c.getAttribute('id')||''};
      }).filter(function(r){return r.url&&r.title})
    `,
    returnByValue: true,
  }, sid)).result.result.value;

  const html = (await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('z-bookcard')).slice(0,50).map(function(c){return c.outerHTML})`,
    returnByValue: true,
  }, sid)).result.result.value;

  const container = (await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('z-bookcard')).slice(0,50).map(function(c){var pc='';try{pc=c.parentElement.className||'';}catch(e){} return {id:c.getAttribute('id'),parentClassName:pc,lang:c.getAttribute('language'),ext:c.getAttribute('extension'),year:c.getAttribute('year'),size:c.getAttribute('filesize')}})`,
    returnByValue: true,
  }, sid)).result.result.value;

  return { info, output: output || [], html: html || [], container: container || [] };
}

function save(label, data) {
  const dir = resolve(FIXTURES_DIR, label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'evaluate-output.json'), JSON.stringify(data.output, null, 2));
  writeFileSync(resolve(dir, 'cards.html'), (data.html || []).join('\n<!-- split -->\n'));
  writeFileSync(resolve(dir, 'container-info.json'), JSON.stringify(data.container, null, 2));
  writeFileSync(resolve(dir, 'page.json'), JSON.stringify(data.info, null, 2));
  const l = [...new Set(data.output.map(b=>b.language).filter(Boolean))].sort();
  const e = [...new Set(data.output.map(b=>b.extension).filter(Boolean))].sort();
  const t = [...new Set(data.output.map(b=>b.contentType).filter(Boolean))].sort();
  console.log(`  ✅ ${data.output.length} cards | langs=[${l}] exts=[${e}] types=[${t}]`);
  return { label, count: data.output.length, langs: l, exts: e, types: t };
}

// ---- Crawl ----
const manifest = [];
const queries = [
  ['search-test',            'https://frenchbooks.sk/s/test'],
  ['search-test-p2',         'https://frenchbooks.sk/s/test?page=2'],
  ['search-harry-potter',    'https://frenchbooks.sk/s/Harry%20Potter'],
  ['search-ml',              'https://frenchbooks.sk/s/machine%20learning'],
  ['search-programming',     'https://frenchbooks.sk/s/programming'],
  ['search-japanese',        'https://frenchbooks.sk/s/%E6%97%A5%E6%9C%AC%E8%AA%9E'],
  ['search-articles',        'https://frenchbooks.sk/s/test?content_type=article'],
  ['search-empty',           'https://frenchbooks.sk/s/xyznonexistent999999'],
];

for (const [label, url] of queries) {
  process.stdout.write(`📦 [${label}] `);
  try {
    await nav(url);
    const data = await extract();
    manifest.push(save(label, data));
  } catch (e) {
    console.log(`  ❌ ${e.message.slice(0, 100)}`);
  }
}

ws.close();

mkdirSync(FIXTURES_DIR, { recursive: true });
writeFileSync(resolve(FIXTURES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n📊 All fixtures in ${FIXTURES_DIR}`);
const dirs = readdirSync(FIXTURES_DIR).filter(d => !d.includes('.') && d !== 'manifest.json');
for (const d of dirs) {
  try {
    const o = JSON.parse(readFileSync(resolve(FIXTURES_DIR, d, 'evaluate-output.json'), 'utf8'));
    const l = [...new Set(o.map(b=>b.language).filter(Boolean))].sort();
    const e = [...new Set(o.map(b=>b.extension).filter(Boolean))].sort();
    console.log(`  ${d}: ${o.length} cards | ${l.join(',')}`);
  } catch(e) {
    console.log(`  ${d}: ⚠️ ${e.message}`);
  }
}
console.log(`\n✅ Done`);
