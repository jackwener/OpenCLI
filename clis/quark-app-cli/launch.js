// cli( registration marker for OpenCLI filesystem discovery
import { spawn, execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { SITE } from './utils.js';

const PORT = 9240;
const EXECUTABLE = '/Applications/QuarkCloudDrive.app/Contents/MacOS/QuarkCloudDrive';

function probe() {
  return new Promise((resolve) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: PORT, path: '/json/version', method: 'GET', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForCdp(seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

cli({
  site: SITE,
  name: 'launch',
  description: 'Launch QuarkCloudDrive with OpenCLI CDP debugging enabled',
  access: 'write',
  strategy: Strategy.LOCAL,
  browser: false,
  args: [
    { name: 'restart', type: 'boolean', default: false, help: 'Kill existing QuarkCloudDrive first' },
  ],
  columns: ['Status', 'Endpoint'],
  func: async (_page, kwargs) => {
    const endpoint = `http://127.0.0.1:${PORT}`;
    if (await probe()) return [{ Status: 'Already running', Endpoint: endpoint }];

    if (kwargs.restart) {
      try { execFileSync('pkill', ['-x', 'QuarkCloudDrive'], { stdio: 'ignore' }); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    spawn(EXECUTABLE, ['--brand-clouddrive', `--remote-debugging-port=${PORT}`], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    if (!await waitForCdp(15)) {
      throw new Error(`QuarkCloudDrive did not expose CDP at ${endpoint}. Try: opencli ${SITE} launch --restart true`);
    }
    return [{ Status: 'Launched', Endpoint: endpoint }];
  },
});
