/**
 * Cleanup test booklists created during exploration.
 */
import { WebSocket } from 'ws';

const CDP_PORT = 9223;
const version = await fetch(`http://localhost:${CDP_PORT}/json/version`).then(r => r.json());
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
    setTimeout(() => reject(Error(`Timeout: ${method}`)), 10000);
  });
}

async function evalInPage(code, timeout = 8000) {
  const targets = (await send('Target.getTargets')).result.targetInfos;
  const target = targets.find(t => t.type === 'page' && t.url && t.url.includes('z-lib.gl') && !t.url.includes('login'));
  if (!target) throw new Error('No tab');
  const attach = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = attach.result.sessionId;
  const result = await send('Runtime.evaluate', { expression: `(function() { return new Promise(function(resolve) { try { ${code} } catch(e) { resolve(JSON.stringify({error: e.message})); } }); })()`, returnByValue: true, awaitPromise: true }, sid);
  await send('Target.detachFromTarget', { sessionId: sid });
  return JSON.parse(result.result.result.value);
}

console.log('✅ Connected\n');

// Get booklists
const lists = await evalInPage(`
  new ZLibraryResponse('/papi/booklist/current-user/').success(function(j) { resolve(JSON.stringify(j.list.map(function(l) { return {id: l.id, title: l.title}; }))); }).fetch();
`);
const testIds = (lists || []).filter(l => l.title?.startsWith('CLI '));
console.log(`📋 Found ${testIds.length} test booklists to delete\n`);

for (const bl of testIds) {
  const result = await evalInPage(`
    new ZLibraryResponse('/papi/booklist/${bl.id}/delete').success(function(j) { resolve(JSON.stringify(j)); }).error(function(j) { resolve(JSON.stringify(j)); }).fetch();
  `);
  console.log(`  ${result.success ? '✅' : '❌'} Deleted ${bl.id} "${bl.title}": ${JSON.stringify(result)}`);
}

const remaining = await evalInPage(`
  new ZLibraryResponse('/papi/booklist/current-user/').success(function(j) { resolve(JSON.stringify(j.list.map(function(l) { return {id: l.id, title: l.title}; }))); }).fetch();
`);
console.log(`\n📋 Remaining: ${remaining.length} booklists`);

ws.close();
console.log('✅ Done');
