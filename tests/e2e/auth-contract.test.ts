import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../../', import.meta.url));
const member = { ResponseStatus: { Ack: 'Success' }, uid: null, userName: '', grade: 30,
  memberAssetSummaries: [{ assetType: 'UserGrade', descInfo: '铂金贵宾' }] };
const anonymous = { ResponseStatus: { Ack: 'Failure', Errors: [{ ErrorCode: 'AccountsMobileRequestFilterException',
  Message: 'Request head is null and cookie auth is null. cookieName: cticket', ErrorFields: [] }] } };

// Run the shipped CLI, lazy adapter loader, browser transport, real probe JS,
// output formatter and exit-code mapping. Only the remote site is a fixture.
async function runWithSite(args: string[], payload: unknown, status = 200) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.ctrip.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const requests: string[] = [];
  dom.window.fetch = (async (url: string) => {
    requests.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  }) as unknown as typeof fetch;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  server.on('connection', ws => ws.on('message', async raw => {
    const { id, method, params } = JSON.parse(raw.toString());
    try {
      let result: unknown = {};
      if (method === 'Page.navigate') dom.reconfigure({ url: params.url });
      if (method === 'Runtime.evaluate') {
        result = { result: { value: await dom.window.eval(params.expression) } };
      }
      if (method === 'Network.getCookies' || method === 'Storage.getCookies') result = { cookies: [] };
      ws.send(JSON.stringify({ id, result }));
      if (method === 'Page.navigate') ws.send(JSON.stringify({ method: 'Page.loadEventFired', params: {} }));
    } catch (error) {
      ws.send(JSON.stringify({ id, error: { message: String(error) } }));
    }
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const child = spawn(process.execPath, ['dist/src/main.js', ...args], {
    cwd: root, env: { ...process.env, OPENCLI_CDP_ENDPOINT: `ws://127.0.0.1:${address.port}`, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    const [code] = await once(child, 'close');
    return { code, stdout, stderr, requests };
  } finally {
    clearTimeout(timer);
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    dom.window.close();
  }
}

describe('CLI auth contract end to end', () => {
  it('returns current Ctrip membership without legacy cookies', async () => {
    const result = await runWithSite(['ctrip', 'whoami', '-f', 'json'], member);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({ logged_in: true, user_id: '', name: '', vip_grade: '30' });
    expect(result.requests).toEqual(['https://m.ctrip.com/restapi/soa2/15201/getMemberSummaryInfo']);
  }, 20_000);
  it.each([
    ['expired session', anonymous, 200, 'AUTH_REQUIRED'],
    ['service outage', {}, 503, 'COMMAND_EXEC'],
  ])('returns the correct typed failure for %s', async (_name, payload, status, errorCode) => {
    const result = await runWithSite(['ctrip', 'whoami', '-f', 'json'], payload, status);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(errorCode);
  }, 20_000);
  it('preserves service errors through full auth status', async () => {
    const result = await runWithSite(['auth', 'status', '--site', 'ctrip', '--full', '-f', 'json'], {}, 503);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data[0].status).toBe('error');
  }, 20_000);
  it('reports quick status as unknown without opening a browser or guessing from cookies', async () => {
    const result = await runWithSite(['auth', 'status', '--site', 'ctrip', '-f', 'json'], member);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data[0].status).toBe('unknown');
    expect(result.requests).toEqual([]);
  }, 20_000);
});
