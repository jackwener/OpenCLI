import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_ORIGINS,
  NATIVE_HOST_NAME,
  listLiveHostStates,
  type HostState,
} from '../../src/host-protocol.js';
import { buildNativeHostManifest } from '../../src/native-manifest.js';
import { requestHost } from '../../src/browser/host-rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const HOST_BIN = path.join(ROOT, 'dist/src/host-bin.js');

type Command = {
  id: string;
  action: string;
  session?: string;
  surface?: 'browser' | 'adapter';
  page?: string;
  url?: string;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
};

type Result = {
  id: string;
  ok: boolean;
  data?: unknown;
  page?: string;
  error?: string;
};

type NativeBridge = {
  close: () => Promise<void>;
  waitForExtension: () => Promise<void>;
  sendCommand: (command: Omit<Command, 'id'>) => Promise<Result>;
};

type TestSite = {
  url: string;
  close: () => Promise<void>;
};

function writeTestHostWrapper(configDir: string): string {
  const wrapper = path.join(configDir, 'bin', process.platform === 'win32' ? 'opencli-host.cmd' : 'opencli-host');
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapper,
      `@echo off\r\nset "OPENCLI_CONFIG_DIR=${configDir.replace(/"/g, '""')}"\r\n"${process.execPath}" "${HOST_BIN}" %*\r\n`,
    );
  } else {
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nexport OPENCLI_CONFIG_DIR=${JSON.stringify(configDir)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(HOST_BIN)} "$@"\n`,
      { encoding: 'utf8', mode: 0o755 },
    );
    fs.chmodSync(wrapper, 0o755);
  }
  return wrapper;
}

function installTestNativeManifest(userDataDir: string, wrapperPath: string): string {
  const dir = path.join(userDataDir, 'NativeMessagingHosts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${NATIVE_HOST_NAME}.json`);
  fs.writeFileSync(file, JSON.stringify(buildNativeHostManifest(wrapperPath, EXTENSION_ORIGINS), null, 2) + '\n');
  return file;
}

async function startNativeBridge(configDir: string, userDataDir: string): Promise<NativeBridge> {
  if (!fs.existsSync(HOST_BIN)) {
    throw new Error(`Missing ${HOST_BIN}; run npm run build before this smoke.`);
  }
  const wrapper = writeTestHostWrapper(configDir);
  installTestNativeManifest(userDataDir, wrapper);
  process.env.OPENCLI_CONFIG_DIR = configDir;

  let host: HostState | null = null;
  let nextId = 0;

  const waitForExtension = async () => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const live = listLiveHostStates();
      if (live.length > 0) {
        try {
          const status = await requestHost(live[0].sock, { id: 'status', action: 'host-status' }, { timeout: 2000 });
          if (status.extensionConnected === true) {
            host = live[0];
            return;
          }
        } catch { /* host still saying hello */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for Chrome to spawn the OpenCLI native host');
  };

  return {
    close: async () => {
      host = null;
    },
    waitForExtension,
    sendCommand: async (command) => {
      if (!host) throw new Error('Native host is not connected');
      const id = `ax-e2e-${++nextId}`;
      const raw = await requestHost(host.sock, { id, ...command }, { timeout: 30_000 });
      return raw as unknown as Result;
    },
  };
}

async function startTestSite(): Promise<TestSite> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://a.opencli.test');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/same-frame') {
      res.end('<!doctype html><button>Same Frame Button</button>');
      return;
    }
    if (url.pathname === '/cross-frame') {
      res.end('<!doctype html><button>Cross Frame Button</button>');
      return;
    }
    res.end(`<!doctype html>
      <main>
        <button>Parent Button</button>
        <iframe title="same frame" src="/same-frame"></iframe>
        <iframe title="cross frame" src="http://b.opencli.test:${addressPort(server)}/cross-frame"></iframe>
      </main>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = addressPort(server);
  return {
    url: `http://a.opencli.test:${port}/`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Server is not listening');
  return address.port;
}

function findChromeExecutable(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((entry): entry is string => !!entry);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const binary of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const resolved = spawnSync('which', [binary], { encoding: 'utf8' });
    const found = resolved.stdout.trim();
    if (resolved.status === 0 && found) return found;
  }
  return null;
}

function launchChrome(chromePath: string, userDataDir: string, startUrl: string, configDir: string): ChildProcess {
  return spawn(chromePath, [
    ...(process.env.OPENCLI_E2E_HEADLESS === '1' && process.env.OPENCLI_E2E_HEADED !== '1'
      ? ['--headless=new']
      : []),
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--enable-unsafe-extension-debugging',
    '--host-resolver-rules=MAP a.opencli.test 127.0.0.1,MAP b.opencli.test 127.0.0.1',
    '--site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-component-update',
    '--disable-popup-blocking',
    '--no-sandbox',
    '--window-size=1280,720',
    startUrl,
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      OPENCLI_CONFIG_DIR: configDir,
    },
  });
}

async function killProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function flattenFrameTree(frameTree: unknown): Array<{ id: string; url: string }> {
  const frames: Array<{ id: string; url: string }> = [];
  function visit(node: any): void {
    const frame = node?.frame;
    if (typeof frame?.id === 'string') {
      frames.push({ id: frame.id, url: String(frame.url ?? frame.unreachableUrl ?? '') });
    }
    for (const child of node?.childFrames ?? []) visit(child);
  }
  visit((frameTree as any)?.frameTree);
  return frames;
}

function axText(axTree: unknown): string {
  const nodes = Array.isArray((axTree as any)?.nodes) ? (axTree as any).nodes : [];
  return nodes.map((node: any) => String(node?.name?.value ?? '')).join('\n');
}

function shouldFailOnBridgeUnavailable(): boolean {
  return process.env.CI === 'true';
}

describe('Browser Bridge AX real Chrome smoke', () => {
  let bridge: NativeBridge | null = null;
  let site: TestSite | null = null;
  let chrome: ChildProcess | null = null;
  let chromeStderr = '';
  let userDataDir = '';
  let configDir = '';
  let skipReason = '';

  beforeAll(async () => {
    const chromePath = findChromeExecutable();
    if (!chromePath) {
      skipReason = 'Chrome executable not found';
      return;
    }
    if (!fs.existsSync(HOST_BIN)) {
      skipReason = `Missing ${HOST_BIN}; run npm run build before this smoke.`;
      return;
    }

    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-ax-config-'));
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-ax-chrome-'));
    bridge = await startNativeBridge(configDir, userDataDir);
    site = await startTestSite();
    chrome = launchChrome(chromePath, userDataDir, 'about:blank', configDir);
    chrome.stderr?.on('data', (chunk) => {
      chromeStderr += chunk.toString();
      if (chromeStderr.length > 20_000) chromeStderr = chromeStderr.slice(-20_000);
    });
    try {
      await bridge.waitForExtension();
    } catch (err) {
      const tail = chromeStderr.split('\n').slice(-30).join('\n').trim();
      const message = `${err instanceof Error ? err.message : String(err)}${tail ? `\nChrome stderr:\n${tail}` : ''}`;
      if (shouldFailOnBridgeUnavailable()) throw new Error(message);
      skipReason = message;
    }
  }, 60_000);

  afterAll(async () => {
    await killProcess(chrome);
    await site?.close();
    await bridge?.close();
    for (const dir of [userDataDir, configDir]) {
      if (!dir) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  });

  it('returns AX nodes for parent and same-origin iframe, and probes cross-origin frame support', async () => {
    if (skipReason) {
      if (shouldFailOnBridgeUnavailable()) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    expect(bridge).toBeTruthy();
    expect(site).toBeTruthy();

    const session = `ax-smoke-${Date.now()}`;
    const browserSession = { session, surface: 'browser' as const };
    const nav = await bridge!.sendCommand({ action: 'navigate', ...browserSession, url: site!.url });
    expect(nav.ok, nav.error).toBe(true);
    expect(nav.page).toBeTruthy();

    const rootEnable = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.enable',
      cdpParams: {},
    });
    expect(rootEnable.ok, rootEnable.error).toBe(true);

    const rootAx = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: {},
    });
    expect(rootAx.ok, rootAx.error).toBe(true);
    expect(axText(rootAx.data)).toContain('Parent Button');

    const frameTree = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Page.getFrameTree',
      cdpParams: {},
    });
    expect(frameTree.ok, frameTree.error).toBe(true);
    const frames = flattenFrameTree(frameTree.data);
    const sameFrame = frames.find((frame) => frame.url.includes('/same-frame'));
    const crossFrame = frames.find((frame) => frame.url.includes('/cross-frame'));
    expect(sameFrame).toBeTruthy();
    expect(crossFrame).toBeTruthy();

    const sameAx = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: sameFrame!.id },
    });
    expect(sameAx.ok, sameAx.error).toBe(true);
    expect(axText(sameAx.data)).toContain('Same Frame Button');

    const crossEnable = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.enable',
      cdpParams: { frameId: crossFrame!.id, sessionId: 'target', targetUrl: crossFrame!.url },
    });
    if (!crossEnable.ok) {
      expect(crossEnable.error).toMatch(/No iframe target found|No target with given id|not supported/i);
      return;
    }

    const crossAx = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: crossFrame!.id, sessionId: 'target', targetUrl: crossFrame!.url },
    });
    expect(crossAx.ok, crossAx.error).toBe(true);
    expect(axText(crossAx.data)).toContain('Cross Frame Button');
  }, 60_000);
});
