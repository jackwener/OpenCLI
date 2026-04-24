import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from './types.js';
import { TargetError } from './browser/target-errors.js';

const {
  mockBrowserConnect,
  mockBrowserClose,
  browserState,
} = vi.hoisted(() => ({
  mockBrowserConnect: vi.fn(),
  mockBrowserClose: vi.fn(),
  browserState: { page: null as IPage | null },
}));

vi.mock('./browser/index.js', () => {
  mockBrowserConnect.mockImplementation(async () => browserState.page as IPage);
  return {
    BrowserBridge: class {
      connect = mockBrowserConnect;
      close = mockBrowserClose;
    },
  };
});

import { createProgram, findPackageRoot, normalizeVerifyRows, renderVerifyPreview, resolveBrowserVerifyInvocation } from './cli.js';

describe('resolveBrowserVerifyInvocation', () => {
  it('prefers the built entry declared in package metadata', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'dist', 'src', 'main.js'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      readFile: () => JSON.stringify({ bin: { opencli: 'dist/src/main.js' } }),
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: process.execPath,
      args: [path.join(projectRoot, 'dist', 'src', 'main.js')],
      cwd: projectRoot,
    });
  });

  it('falls back to compatibility built-entry candidates when package metadata is unavailable', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'dist', 'src', 'main.js'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      readFile: () => { throw new Error('no package json'); },
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: process.execPath,
      args: [path.join(projectRoot, 'dist', 'src', 'main.js')],
      cwd: projectRoot,
    });
  });

  it('falls back to the local tsx binary in source checkouts on Windows', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'src', 'main.ts'),
      path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      platform: 'win32',
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd'),
      args: [path.join(projectRoot, 'src', 'main.ts')],
      cwd: projectRoot,
      shell: true,
    });
  });

  it('falls back to npx tsx when local tsx is unavailable', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'src', 'main.ts'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      platform: 'linux',
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: 'npx',
      args: ['tsx', path.join(projectRoot, 'src', 'main.ts')],
      cwd: projectRoot,
    });
  });
});

describe('browser tab targeting commands', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  function getBrowserStateFile(cacheDir: string): string {
    return path.join(cacheDir, 'browser-state', 'browser_default.json');
  }

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.OPENCLI_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-tab-state-'));
    consoleLogSpy.mockClear();
    stderrSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);

    browserState.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      getCurrentUrl: vi.fn().mockResolvedValue('https://one.example'),
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      getCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn().mockResolvedValue({ ok: true }),
      tabs: vi.fn().mockResolvedValue([
        { index: 0, page: 'tab-1', url: 'https://one.example', title: 'one', active: true },
        { index: 1, page: 'tab-2', url: 'https://two.example', title: 'two', active: false },
      ]),
      selectTab: vi.fn().mockResolvedValue(undefined),
      newTab: vi.fn().mockResolvedValue('tab-3'),
      closeTab: vi.fn().mockResolvedValue(undefined),
      frames: vi.fn().mockResolvedValue([
        { index: 0, frameId: 'frame-1', url: 'https://x.example/embed', name: 'x-embed' },
      ]),
      evaluateInFrame: vi.fn().mockResolvedValue('inside frame'),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
    } as unknown as IPage;
  });

  function lastJsonLog(): any {
    const calls = consoleLogSpy.mock.calls;
    if (calls.length === 0) throw new Error('Expected at least one console.log call');
    const last = calls[calls.length - 1][0];
    if (typeof last !== 'string') throw new Error(`Expected string arg to console.log, got ${typeof last}`);
    return JSON.parse(last);
  }

  it('binds browser commands to an explicit target tab via --tab', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'eval', '--tab', 'tab-2', 'document.title']);

    expect(browserState.page?.setActivePage).toHaveBeenCalledWith('tab-2');
    expect(browserState.page?.evaluate).toHaveBeenCalledWith('document.title');
  });

  it('rejects an explicit --tab target that is no longer in the current session', async () => {
    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn(),
      tabs: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn(),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'eval', '--tab', 'tab-stale', 'document.title']);

    expect(process.exitCode).toBeDefined();
    expect(browserState.page?.setActivePage).not.toHaveBeenCalled();
    expect(browserState.page?.evaluate).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Target tab tab-stale is not part of the current browser session');
  });

  it('lists tabs with target IDs via browser tab list', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'list']);

    expect(browserState.page?.tabs).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"page": "tab-1"');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"page": "tab-2"');
  });

  it('creates a new tab and prints its target ID', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'new', 'https://three.example']);

    expect(browserState.page?.newTab).toHaveBeenCalledWith('https://three.example');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"page": "tab-3"');
  });

  it('prints the resolved target ID when browser open creates or navigates a tab', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'open', 'https://example.com']);

    expect(browserState.page?.goto).toHaveBeenCalledWith('https://example.com');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"url": "https://one.example"');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"page": "tab-1"');
  });

  it('lists cross-origin frames via browser frames', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'frames']);

    expect(browserState.page?.frames).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"frameId": "frame-1"');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"url": "https://x.example/embed"');
  });

  it('routes browser eval --frame through frame-targeted evaluation', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'eval', '--frame', '0', 'document.title']);

    expect(browserState.page?.evaluateInFrame).toHaveBeenCalledWith('document.title', 0);
    expect(browserState.page?.evaluate).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('inside frame');
  });

  it('does not promote a newly created tab to the persisted default target', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'new', 'https://three.example']);
    await program.parseAsync(['node', 'opencli', 'browser', 'eval', 'document.title']);

    expect(browserState.page?.newTab).toHaveBeenCalledWith('https://three.example');
    expect(browserState.page?.setActivePage).not.toHaveBeenCalled();
    expect(browserState.page?.evaluate).toHaveBeenCalledWith('document.title');
  });

  it('persists an explicitly selected tab as the default target for later untargeted commands', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'select', 'tab-2']);
    await program.parseAsync(['node', 'opencli', 'browser', 'eval', 'document.title']);

    expect(browserState.page?.selectTab).toHaveBeenCalledWith('tab-2');
    expect(browserState.page?.setActivePage).toHaveBeenCalledWith('tab-2');
    expect(browserState.page?.evaluate).toHaveBeenCalledWith('document.title');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"selected": "tab-2"');
  });

  it('clears a saved default target when it is no longer present in the current session', async () => {
    const cacheDir = String(process.env.OPENCLI_CACHE_DIR);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'select', 'tab-2']);
    expect(fs.existsSync(getBrowserStateFile(cacheDir))).toBe(true);

    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn(),
      tabs: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn().mockResolvedValue({ ok: true }),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
    } as unknown as IPage;

    await program.parseAsync(['node', 'opencli', 'browser', 'eval', 'document.title']);

    expect(browserState.page?.setActivePage).not.toHaveBeenCalled();
    expect(browserState.page?.evaluate).toHaveBeenCalledWith('document.title');
    expect(fs.existsSync(getBrowserStateFile(cacheDir))).toBe(false);
  });

  it('clears the persisted default target when that tab is closed', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'select', 'tab-2']);
    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'close', 'tab-2']);
    vi.mocked(browserState.page?.setActivePage as any).mockClear();
    vi.mocked(browserState.page?.evaluate as any).mockClear();

    await program.parseAsync(['node', 'opencli', 'browser', 'eval', 'document.title']);

    expect(browserState.page?.closeTab).toHaveBeenCalledWith('tab-2');
    expect(browserState.page?.setActivePage).not.toHaveBeenCalled();
    expect(browserState.page?.evaluate).toHaveBeenCalledWith('document.title');
  });

  it('closes a tab by target ID', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'close', 'tab-2']);

    expect(browserState.page?.closeTab).toHaveBeenCalledWith('tab-2');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('"closed": "tab-2"');
  });

  it('rejects closing a stale tab target ID that is no longer in the current session', async () => {
    browserState.page = {
      tabs: vi.fn().mockResolvedValue([]),
      closeTab: vi.fn(),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'tab', 'close', 'tab-stale']);

    expect(process.exitCode).toBeDefined();
    expect(browserState.page?.closeTab).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Target tab tab-stale is not part of the current browser session');
  });

  it('browser analyze merges HttpOnly cookie names from page.getCookies and drains stale capture before verdict', async () => {
    browserState.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      getCurrentUrl: vi.fn().mockResolvedValue('https://target.example'),
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      getCookies: vi.fn().mockResolvedValue([{ name: 'cf_clearance', value: 'x', domain: '.target.example' }]),
      evaluate: vi.fn().mockResolvedValue({
        cookieNames: [],
        initialState: {
          __INITIAL_STATE__: false,
          __NUXT__: false,
          __NEXT_DATA__: false,
          __APOLLO_STATE__: false,
        },
        title: 'Target',
        finalUrl: 'https://target.example/',
      }),
      tabs: vi.fn().mockResolvedValue([{ index: 0, page: 'tab-1', url: 'https://target.example', title: 'Target', active: true }]),
      readNetworkCapture: vi.fn()
        .mockResolvedValueOnce([
          {
            url: 'https://stale.example/api/old',
            method: 'GET',
            responseStatus: 200,
            responseContentType: 'application/json',
            responsePreview: '{"stale":true}',
          },
        ])
        .mockResolvedValueOnce([
          {
            url: 'https://target.example/waf',
            method: 'GET',
            responseStatus: 403,
            responseContentType: 'text/html',
            responsePreview: 'Cloudflare Ray ID',
          },
        ]),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'analyze', 'https://target.example/']);

    const out = lastJsonLog();
    expect(browserState.page?.readNetworkCapture).toHaveBeenCalledTimes(2);
    expect(out.anti_bot.vendor).toBe('cloudflare');
    expect(out.anti_bot.evidence).toContain('cookie:cf_clearance');
  });

  it('browser analyze falls back to interceptor buffer when network capture is unsupported', async () => {
    let bufferReads = 0;
    browserState.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      getCurrentUrl: vi.fn().mockResolvedValue('https://target.example'),
      startNetworkCapture: vi.fn().mockResolvedValue(false),
      getCookies: vi.fn().mockResolvedValue([{ name: 'cf_clearance', value: 'x', domain: '.target.example' }]),
      evaluate: vi.fn().mockImplementation(async (arg: string) => {
        if (typeof arg === 'string' && arg.includes('document.cookie')) {
          return {
            cookieNames: [],
            initialState: {
              __INITIAL_STATE__: false,
              __NUXT__: false,
              __NEXT_DATA__: false,
              __APOLLO_STATE__: false,
            },
            title: 'Target',
            finalUrl: 'https://target.example/',
          };
        }
        if (typeof arg === 'string' && arg.includes('window.__opencli_net = []')) {
          bufferReads += 1;
          if (bufferReads === 1) {
            return JSON.stringify([
              {
                url: 'https://stale.example/api/old',
                method: 'GET',
                status: 200,
                size: 12,
                ct: 'application/json',
                body: { stale: true },
              },
            ]);
          }
          return JSON.stringify([
            {
              url: 'https://target.example/waf',
              method: 'GET',
              status: 403,
              size: 17,
              ct: 'text/html',
              body: 'Cloudflare Ray ID',
            },
          ]);
        }
        return undefined;
      }),
      tabs: vi.fn().mockResolvedValue([{ index: 0, page: 'tab-1', url: 'https://target.example', title: 'Target', active: true }]),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'analyze', 'https://target.example/']);

    const out = lastJsonLog();
    expect(browserState.page?.readNetworkCapture).toHaveBeenCalledTimes(2);
    expect(bufferReads).toBe(2);
    expect(out.anti_bot.vendor).toBe('cloudflare');
    expect(out.anti_bot.evidence).toContain('cookie:cf_clearance');
    expect(out.anti_bot.evidence).toContain('body:https://target.example/waf');
  });

  it('browser wait xhr starts capture, injects interceptor on fallback, and ignores stale ring entries', async () => {
    browserState.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      getCurrentUrl: vi.fn().mockResolvedValue('https://target.example'),
      startNetworkCapture: vi.fn().mockResolvedValue(false),
      evaluate: vi.fn().mockResolvedValue(undefined),
      tabs: vi.fn().mockResolvedValue([{ index: 0, page: 'tab-1', url: 'https://target.example', title: 'Target', active: true }]),
      readNetworkCapture: vi.fn()
        .mockResolvedValueOnce([
          {
            url: 'https://stale.example/api/old',
            method: 'GET',
            responseStatus: 200,
            responseContentType: 'application/json',
            responsePreview: '{"stale":true}',
          },
        ])
        .mockResolvedValueOnce([
          {
            url: 'https://target.example/api/target',
            method: 'GET',
            responseStatus: 200,
            responseContentType: 'application/json',
            responsePreview: '{"ok":true}',
          },
        ]),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'wait', 'xhr', '/api/target', '--timeout', '900']);

    const out = lastJsonLog();
    expect(browserState.page?.startNetworkCapture).toHaveBeenCalledTimes(1);
    expect(browserState.page?.evaluate).toHaveBeenCalledWith(expect.stringContaining('window.__opencli_net'));
    expect(browserState.page?.readNetworkCapture).toHaveBeenCalledTimes(2);
    expect(out.matched.url).toBe('https://target.example/api/target');
  });

  it('browser wait xhr reads interceptor buffer when network capture is unsupported', async () => {
    let bufferReads = 0;
    browserState.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      getCurrentUrl: vi.fn().mockResolvedValue('https://target.example'),
      startNetworkCapture: vi.fn().mockResolvedValue(false),
      evaluate: vi.fn().mockImplementation(async (arg: string) => {
        if (typeof arg === 'string' && arg.includes('window.__opencli_net = []')) {
          bufferReads += 1;
          if (bufferReads === 1) {
            return JSON.stringify([
              {
                url: 'https://stale.example/api/old',
                method: 'GET',
                status: 200,
                size: 12,
                ct: 'application/json',
                body: { stale: true },
              },
            ]);
          }
          return JSON.stringify([
            {
              url: 'https://target.example/api/target',
              method: 'GET',
              status: 200,
              size: 11,
              ct: 'application/json',
              body: { ok: true },
            },
          ]);
        }
        return undefined;
      }),
      tabs: vi.fn().mockResolvedValue([{ index: 0, page: 'tab-1', url: 'https://target.example', title: 'Target', active: true }]),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
    } as unknown as IPage;

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'wait', 'xhr', '/api/target', '--timeout', '900']);

    const out = lastJsonLog();
    expect(browserState.page?.startNetworkCapture).toHaveBeenCalledTimes(1);
    expect(browserState.page?.readNetworkCapture).toHaveBeenCalledTimes(2);
    expect(bufferReads).toBe(2);
    expect(out.matched.url).toBe('https://target.example/api/target');
  });
});

describe('browser network command', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  function getNetworkCachePath(cacheDir: string): string {
    return path.join(cacheDir, 'browser-network', 'browser_default.json');
  }

  function lastJsonLog(): any {
    const calls = consoleLogSpy.mock.calls;
    if (calls.length === 0) throw new Error('Expected at least one console.log call');
    const last = calls[calls.length - 1][0];
    if (typeof last !== 'string') throw new Error(`Expected string arg to console.log, got ${typeof last}`);
    return JSON.parse(last);
  }

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.OPENCLI_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-net-'));
    consoleLogSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);

    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      tabs: vi.fn().mockResolvedValue([{ page: 'tab-1', active: true }]),
      evaluate: vi.fn().mockResolvedValue(''),
      readNetworkCapture: vi.fn().mockResolvedValue([
        {
          url: 'https://x.com/i/api/graphql/qid/UserTweets?v=1',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: JSON.stringify({ data: { user: { rest_id: '42' } } }),
        },
        {
          url: 'https://cdn.example.com/app.js',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/javascript',
          responsePreview: '// js',
        },
      ]),
    } as unknown as IPage;
  });

  it('emits JSON with shape previews and persists the capture to disk', async () => {
    const cacheDir = String(process.env.OPENCLI_CACHE_DIR);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network']);

    const out = lastJsonLog();
    expect(out.count).toBe(1);
    expect(out.filtered_out).toBe(1);
    expect(out.entries[0].key).toBe('UserTweets');
    expect(out.entries[0].shape['$.data.user.rest_id']).toBe('string');
    expect(out.entries[0]).not.toHaveProperty('body');
    expect(fs.existsSync(getNetworkCachePath(cacheDir))).toBe(true);
  });

  it('--all includes static resources that the default filter drops', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network', '--all']);

    const out = lastJsonLog();
    expect(out.count).toBe(2);
    expect(out.entries.map((e: any) => e.key)).toContain('UserTweets');
    expect(out.entries.map((e: any) => e.key)).toContain('GET cdn.example.com/app.js');
  });

  it('--raw emits full bodies inline for every entry', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network', '--raw']);

    const out = lastJsonLog();
    expect(out.entries[0].body).toEqual({ data: { user: { rest_id: '42' } } });
  });

  it('--detail <key> returns the full body for the requested entry', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network']);
    consoleLogSpy.mockClear();
    await program.parseAsync(['node', 'opencli', 'browser', 'network', '--detail', 'UserTweets']);

    const out = lastJsonLog();
    expect(out.key).toBe('UserTweets');
    expect(out.body).toEqual({ data: { user: { rest_id: '42' } } });
    expect(out.shape['$.data.user.rest_id']).toBe('string');
  });

  it('--detail reports key_not_found with the list of available keys', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network']);
    consoleLogSpy.mockClear();
    await program.parseAsync(['node', 'opencli', 'browser', 'network', '--detail', 'NopeOp']);

    const out = lastJsonLog();
    expect(out.error.code).toBe('key_not_found');
    expect(out.error.available_keys).toContain('UserTweets');
    expect(process.exitCode).toBeDefined();
  });

  it('--detail reports cache_missing when no capture has been persisted yet', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network', '--detail', 'UserTweets']);

    const out = lastJsonLog();
    expect(out.error.code).toBe('cache_missing');
    expect(process.exitCode).toBeDefined();
  });

  it('emits capture_failed when readNetworkCapture throws', async () => {
    (browserState.page!.readNetworkCapture as any) = vi.fn().mockRejectedValue(new Error('CDP disconnected'));
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'network']);

    const out = lastJsonLog();
    expect(out.error.code).toBe('capture_failed');
    expect(out.error.message).toContain('CDP disconnected');
    expect(process.exitCode).toBeDefined();
  });

  it('surfaces cache_warning in the envelope when persistence fails', async () => {
    const cacheDir = String(process.env.OPENCLI_CACHE_DIR);
    // Pre-create the target path as a file where a directory is expected,
    // forcing the mkdir inside saveNetworkCache to throw.
    const clashDir = path.join(cacheDir, 'browser-network');
    fs.writeFileSync(clashDir, 'not-a-directory');

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'network']);

    const out = lastJsonLog();
    expect(out.cache_warning).toMatch(/Could not persist capture cache/);
    expect(out.count).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });

  describe('--filter', () => {
    function apiResponse(url: string, body: unknown): Record<string, unknown> {
      return {
        url,
        method: 'GET',
        responseStatus: 200,
        responseContentType: 'application/json',
        responsePreview: JSON.stringify(body),
      };
    }

    beforeEach(() => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        apiResponse(
          'https://x.com/i/api/graphql/qid/UserTweets?v=1',
          { data: { items: [{ author: 'a', text: 't', likes: 1 }] } },
        ),
        apiResponse(
          'https://x.com/i/api/graphql/qid/UserProfile?v=1',
          { data: { user: { id: 'u1', followers: 10 } } },
        ),
        apiResponse(
          'https://x.com/i/api/graphql/qid/Settings?v=1',
          { config: { theme: 'dark' } },
        ),
      ]);
    });

    it('narrows entries to those whose shape has ALL named fields', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'author,text,likes']);

      const out = lastJsonLog();
      expect(out.count).toBe(1);
      expect(out.filter).toEqual(['author', 'text', 'likes']);
      expect(out.filter_dropped).toBe(2);
      expect(out.entries[0].key).toBe('UserTweets');
    });

    it('matches container segments too, not just leaf names (any-segment rule)', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'data,items']);

      const out = lastJsonLog();
      expect(out.count).toBe(1);
      expect(out.entries[0].key).toBe('UserTweets');
    });

    it('drops entries that are missing any required field (AND semantics)', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'author,followers']);

      const out = lastJsonLog();
      expect(out.count).toBe(0);
      expect(out.entries).toEqual([]);
      expect(out.filter).toEqual(['author', 'followers']);
      expect(out.filter_dropped).toBe(3);
    });

    it('returns empty entries (not an error) when nothing matches', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'nonexistent_field']);

      const out = lastJsonLog();
      expect(out.count).toBe(0);
      expect(out.entries).toEqual([]);
      expect(out).not.toHaveProperty('error');
      expect(process.exitCode).toBeUndefined();
    });

    it('is case-sensitive so agents do not conflate `Id` with `id`', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'Data']);

      const out = lastJsonLog();
      expect(out.count).toBe(0);
    });

    it('persists the full (unfiltered) capture so --detail lookups still find filtered-out keys', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'author,text,likes']);
      consoleLogSpy.mockClear();
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--detail', 'UserProfile']);

      const out = lastJsonLog();
      expect(out.key).toBe('UserProfile');
      expect(out.body).toEqual({ data: { user: { id: 'u1', followers: 10 } } });
    });

    it('composes with --raw: entries keep full bodies, filter still narrows', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'author', '--raw']);

      const out = lastJsonLog();
      expect(out.count).toBe(1);
      expect(out.entries[0].body).toEqual({ data: { items: [{ author: 'a', text: 't', likes: 1 }] } });
    });

    it('reports invalid_filter for empty value', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', '']);

      const out = lastJsonLog();
      expect(out.error.code).toBe('invalid_filter');
      expect(process.exitCode).toBeDefined();
    });

    it('reports invalid_filter for commas-only value', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', ',,,']);

      const out = lastJsonLog();
      expect(out.error.code).toBe('invalid_filter');
      expect(process.exitCode).toBeDefined();
    });

    it('rejects --filter combined with --detail as invalid_args', async () => {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--filter', 'author', '--detail', 'UserTweets']);

      const out = lastJsonLog();
      expect(out.error.code).toBe('invalid_args');
      expect(out.error.message).toContain('--filter');
      expect(out.error.message).toContain('--detail');
      expect(process.exitCode).toBeDefined();
    });
  });

  describe('body truncation signals', () => {
    it('flags body_truncated in list view when the capture layer capped the body', async () => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/huge',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: '{"data":"x"}',
          responseBodyFullSize: 99_999_999,
          responseBodyTruncated: true,
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network']);

      const out = lastJsonLog();
      expect(out.body_truncated_count).toBe(1);
      expect(out.entries[0].body_truncated).toBe(true);
      expect(out.entries[0].size).toBe(99_999_999);
    });

    it('--detail surfaces body_truncated + body_full_size when capture had to cap the body', async () => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/huge',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: 'truncated-prefix-not-valid-json',
          responseBodyFullSize: 50_000_000,
          responseBodyTruncated: true,
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network']);
      consoleLogSpy.mockClear();
      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--detail', 'GET api.example.com/huge']);

      const out = lastJsonLog();
      expect(out.body_truncated).toBe(true);
      expect(out.body_full_size).toBe(50_000_000);
      expect(out.body_truncation_reason).toBe('capture-limit');
    });

    it('--max-body caps the emitted body and marks body_truncation_reason = max-body', async () => {
      const longString = 'x'.repeat(5000);
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/plain',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'text/plain',
          responsePreview: longString,
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network']);
      consoleLogSpy.mockClear();
      await program.parseAsync([
        'node', 'opencli', 'browser', 'network',
        '--detail', 'GET api.example.com/plain',
        '--max-body', '100',
      ]);

      const out = lastJsonLog();
      expect(typeof out.body).toBe('string');
      expect(out.body).toHaveLength(100);
      expect(out.body_truncated).toBe(true);
      expect(out.body_truncation_reason).toBe('max-body');
      expect(out.body_full_size).toBe(5000);
    });

    it('--max-body leaves parsed JSON bodies untouched (no mid-object cut)', async () => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/json',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: JSON.stringify({ data: { user: { rest_id: 'u1' } } }),
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network']);
      consoleLogSpy.mockClear();
      await program.parseAsync([
        'node', 'opencli', 'browser', 'network',
        '--detail', 'GET api.example.com/json',
        '--max-body', '10',
      ]);

      const out = lastJsonLog();
      // JSON body already parsed at capture time — --max-body only applies to
      // string bodies (which is where the agent-visible hazard lives).
      expect(out.body).toEqual({ data: { user: { rest_id: 'u1' } } });
      expect(out).not.toHaveProperty('body_truncated');
    });

    it('rejects non-numeric --max-body with invalid_max_body', async () => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/x',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: '{"a":1}',
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network']);
      consoleLogSpy.mockClear();
      await program.parseAsync([
        'node', 'opencli', 'browser', 'network',
        '--detail', 'GET api.example.com/x',
        '--max-body', 'abc',
      ]);

      expect(lastJsonLog().error.code).toBe('invalid_max_body');
      expect(process.exitCode).toBeDefined();
    });

    it('--raw emits snake_case body_truncated / body_full_size, matching non-raw + detail', async () => {
      browserState.page!.readNetworkCapture = vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/huge',
          method: 'GET',
          responseStatus: 200,
          responseContentType: 'application/json',
          responsePreview: 'truncated-prefix',
          responseBodyFullSize: 20_000_000,
          responseBodyTruncated: true,
        },
      ]);
      const program = createProgram('', '');

      await program.parseAsync(['node', 'opencli', 'browser', 'network', '--raw']);

      const out = lastJsonLog();
      expect(out.entries).toHaveLength(1);
      const entry = out.entries[0];
      expect(entry.body_truncated).toBe(true);
      expect(entry.body_full_size).toBe(20_000_000);
      // Internal camelCase must not leak into the agent-facing envelope.
      expect(entry).not.toHaveProperty('bodyTruncated');
      expect(entry).not.toHaveProperty('bodyFullSize');
    });
  });
});

describe('browser get html command', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  function lastLogArg(): unknown {
    const calls = consoleLogSpy.mock.calls;
    if (calls.length === 0) throw new Error('expected console.log call');
    return calls[calls.length - 1][0];
  }
  function lastJsonLog(): any {
    const arg = lastLogArg();
    if (typeof arg !== 'string') throw new Error(`expected string arg, got ${typeof arg}`);
    return JSON.parse(arg);
  }

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.OPENCLI_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-html-'));
    consoleLogSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);

    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      tabs: vi.fn().mockResolvedValue([{ page: 'tab-1', active: true }]),
      evaluate: vi.fn(),
    } as unknown as IPage;
  });

  it('returns full outerHTML by default with no truncation', async () => {
    const big = '<div>' + 'x'.repeat(100_000) + '</div>';
    (browserState.page!.evaluate as any).mockResolvedValueOnce({ kind: 'ok', html: big });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html']);

    expect(lastLogArg()).toBe(big);
  });

  it('caps output with --max and prepends a visible truncation marker', async () => {
    const big = '<div>' + 'x'.repeat(500) + '</div>';
    (browserState.page!.evaluate as any).mockResolvedValueOnce({ kind: 'ok', html: big });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--max', '100']);

    const out = String(lastLogArg());
    expect(out.startsWith('<!-- opencli: truncated 100 of')).toBe(true);
    expect(out.length).toBeGreaterThan(100);
    expect(out.length).toBeLessThan(big.length);
  });

  it('rejects negative --max with invalid_max error', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--max', '-1']);

    expect(lastJsonLog().error.code).toBe('invalid_max');
    expect(process.exitCode).toBeDefined();
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
  });

  it('rejects fractional --max with invalid_max error', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--max', '1.5']);

    expect(lastJsonLog().error.code).toBe('invalid_max');
    expect(process.exitCode).toBeDefined();
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
  });

  it('rejects non-numeric --max (e.g. "10abc") with invalid_max error', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--max', '10abc']);

    expect(lastJsonLog().error.code).toBe('invalid_max');
    expect(process.exitCode).toBeDefined();
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
  });

  it('--as json returns structured tree envelope', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      selector: '.hero',
      matched: 1,
      tree: { tag: 'div', attrs: { class: 'hero' }, text: 'Hi', children: [] },
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--selector', '.hero', '--as', 'json']);

    const out = lastJsonLog();
    expect(out.matched).toBe(1);
    expect(out.tree.tag).toBe('div');
    expect(out.tree.attrs.class).toBe('hero');
  });

  it('--as json emits selector_not_found when matched is 0', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({ selector: '.missing', matched: 0, tree: null });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--selector', '.missing', '--as', 'json']);

    expect(lastJsonLog().error.code).toBe('selector_not_found');
    expect(process.exitCode).toBeDefined();
  });

  it('raw mode emits selector_not_found when the selector matches nothing', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({ kind: 'ok', html: null });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--selector', '.missing']);

    expect(lastJsonLog().error.code).toBe('selector_not_found');
    expect(process.exitCode).toBeDefined();
  });

  it('raw mode emits invalid_selector when the page rejects the selector syntax', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      kind: 'invalid_selector',
      reason: "'##$@@' is not a valid selector",
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--selector', '##$@@']);

    const err = lastJsonLog().error;
    expect(err.code).toBe('invalid_selector');
    expect(err.message).toContain('##$@@');
    expect(err.message).toContain('not a valid selector');
    expect(process.exitCode).toBeDefined();
  });

  it('--as json emits invalid_selector when the page rejects the selector syntax', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      selector: '##$@@',
      invalidSelector: true,
      reason: "'##$@@' is not a valid selector",
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--selector', '##$@@', '--as', 'json']);

    const err = lastJsonLog().error;
    expect(err.code).toBe('invalid_selector');
    expect(err.message).toContain('##$@@');
    expect(process.exitCode).toBeDefined();
  });

  it('rejects unknown --as format with invalid_format error', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'html', '--as', 'yaml']);

    expect(lastJsonLog().error.code).toBe('invalid_format');
    expect(process.exitCode).toBeDefined();
  });
});

// Shared helper for the selector-first describe blocks below.
// Each block spies console.log, mocks the IPage surface it touches, and
// parses the last stringified call to inspect the JSON envelope — the
// canonical agent-facing contract for the selector-first commands.
function installSelectorFirstTestHarness(label: string, pageOverrides: () => Partial<IPage>) {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  function lastLogArg(): unknown {
    const calls = consoleLogSpy.mock.calls;
    if (calls.length === 0) throw new Error('expected console.log call');
    return calls[calls.length - 1][0];
  }
  function lastJsonLog(): any {
    const arg = lastLogArg();
    if (typeof arg !== 'string') throw new Error(`expected string arg, got ${typeof arg}`);
    return JSON.parse(arg);
  }

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.OPENCLI_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `opencli-${label}-`));
    consoleLogSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);

    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      tabs: vi.fn().mockResolvedValue([{ page: 'tab-1', active: true }]),
      ...pageOverrides(),
    } as unknown as IPage;
  });

  return { lastJsonLog };
}

describe('browser find command', () => {
  const { lastJsonLog } = installSelectorFirstTestHarness('find', () => ({
    evaluate: vi.fn(),
  }));

  it('returns a {matches_n, entries} envelope for a matching selector', async () => {
    // `find` always returns numeric refs (existing on snapshot-tagged elements,
    // allocated on the spot for fresh matches) — see reviewer contract in
    // #opencli-browser msg 52c51eb6.
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      matches_n: 2,
      entries: [
        { nth: 0, ref: 5, tag: 'button', role: '', text: 'OK', attrs: { class: 'btn' }, visible: true },
        { nth: 1, ref: 17, tag: 'button', role: '', text: 'Cancel', attrs: { class: 'btn' }, visible: true },
      ],
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find', '--css', '.btn']);

    const out = lastJsonLog();
    expect(out.matches_n).toBe(2);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].ref).toBe(5);
    expect(out.entries[1].ref).toBe(17);
    expect(process.exitCode).toBeUndefined();
  });

  it('forwards --limit / --text-max into the generated JS', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({ matches_n: 0, entries: [] });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find', '--css', '.btn', '--limit', '3', '--text-max', '20']);

    const js = (browserState.page!.evaluate as any).mock.calls[0][0] as string;
    expect(js).toContain('LIMIT = 3');
    expect(js).toContain('TEXT_MAX = 20');
  });

  it('emits invalid_selector envelope when the page rejects selector syntax', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      error: { code: 'invalid_selector', message: 'Invalid CSS selector: ">>>"', hint: 'Check the selector syntax.' },
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find', '--css', '>>>']);

    expect(lastJsonLog().error.code).toBe('invalid_selector');
    expect(process.exitCode).toBeDefined();
  });

  it('emits selector_not_found envelope when the selector matches nothing', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      error: { code: 'selector_not_found', message: 'CSS selector ".missing" matched 0 elements', hint: 'Use browser state to inspect the page.' },
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find', '--css', '.missing']);

    expect(lastJsonLog().error.code).toBe('selector_not_found');
    expect(process.exitCode).toBeDefined();
  });

  it('rejects missing --css with usage_error (no evaluate call)', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find']);

    expect(lastJsonLog().error.code).toBe('usage_error');
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
    expect(process.exitCode).toBeDefined();
  });

  it('rejects malformed --limit with usage_error (no evaluate call)', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'find', '--css', '.btn', '--limit', 'abc']);

    expect(lastJsonLog().error.code).toBe('usage_error');
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
    expect(process.exitCode).toBeDefined();
  });
});

describe('browser get text/value/attributes commands', () => {
  const { lastJsonLog } = installSelectorFirstTestHarness('get-sel', () => ({
    evaluate: vi.fn(),
  }));

  it('emits {value, matches_n, match_level} envelope for a numeric ref', async () => {
    const evalMock = browserState.page!.evaluate as any;
    // 1st call: resolveTargetJs -> { ok: true, matches_n: 1, match_level: 'exact' }
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 1, match_level: 'exact' });
    // 2nd call: getTextResolvedJs -> the element's text
    evalMock.mockResolvedValueOnce('Hello world');
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'text', '7']);

    expect(lastJsonLog()).toEqual({ value: 'Hello world', matches_n: 1, match_level: 'exact' });
  });

  it('reports matches_n on multi-match CSS (read path: first match wins)', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 3, match_level: 'exact' });
    evalMock.mockResolvedValueOnce('first');
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'text', '.btn']);

    expect(lastJsonLog()).toEqual({ value: 'first', matches_n: 3, match_level: 'exact' });
  });

  it('parses the attributes payload back into a real object', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 1, match_level: 'exact' });
    // getAttributesResolvedJs returns a JSON-encoded string — the CLI must parse it
    evalMock.mockResolvedValueOnce(JSON.stringify({ id: 'nav', class: 'hero' }));
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'attributes', '#nav']);

    const out = lastJsonLog();
    expect(out.matches_n).toBe(1);
    expect(out.match_level).toBe('exact');
    expect(out.value).toEqual({ id: 'nav', class: 'hero' });
  });

  it('propagates selector_not_found from the resolver as an error envelope', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      ok: false,
      code: 'selector_not_found',
      message: 'CSS selector ".missing" matched 0 elements',
      hint: 'Try a less specific selector.',
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'text', '.missing']);

    expect(lastJsonLog().error.code).toBe('selector_not_found');
    expect(process.exitCode).toBeDefined();
  });

  it('forwards --nth into the resolver opts and reports matches_n', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 4, match_level: 'exact' });
    evalMock.mockResolvedValueOnce('second');
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'value', '.btn', '--nth', '1']);

    const resolveJs = evalMock.mock.calls[0][0] as string;
    // resolveTargetJs embeds nth as a raw number literal; look for the binding
    expect(resolveJs).toContain('const nth = 1');
    expect(lastJsonLog()).toEqual({ value: 'second', matches_n: 4, match_level: 'exact' });
  });

  it('rejects malformed --nth with usage_error before touching the page', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'get', 'text', '.btn', '--nth', 'abc']);

    expect(lastJsonLog().error.code).toBe('usage_error');
    expect(browserState.page!.evaluate).not.toHaveBeenCalled();
    expect(process.exitCode).toBeDefined();
  });
});

describe('browser click/type commands', () => {
  const { lastJsonLog } = installSelectorFirstTestHarness('click-type', () => ({
    evaluate: vi.fn().mockResolvedValue(false),
    click: vi.fn().mockResolvedValue({ matches_n: 1, match_level: 'exact' }),
    typeText: vi.fn().mockResolvedValue({ matches_n: 1, match_level: 'exact' }),
    wait: vi.fn().mockResolvedValue(undefined),
  }));

  it('emits {clicked, target, matches_n, match_level} on success', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'exact' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '#save']);

    expect(browserState.page!.click).toHaveBeenCalledWith('#save', {});
    expect(lastJsonLog()).toEqual({ clicked: true, target: '#save', matches_n: 1, match_level: 'exact' });
  });

  it('surfaces match_level=stable when resolver falls back to fingerprint match', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'stable' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '7']);

    expect(lastJsonLog()).toEqual({ clicked: true, target: '7', matches_n: 1, match_level: 'stable' });
  });

  it('forwards --nth as ResolveOptions.nth to page.click', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 3, match_level: 'exact' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '.btn', '--nth', '2']);

    expect(browserState.page!.click).toHaveBeenCalledWith('.btn', { nth: 2 });
    expect(lastJsonLog()).toEqual({ clicked: true, target: '.btn', matches_n: 3, match_level: 'exact' });
  });

  it('surfaces selector_ambiguous from page.click as an error envelope', async () => {
    (browserState.page!.click as any).mockRejectedValueOnce(new TargetError({
      code: 'selector_ambiguous',
      message: 'CSS selector ".btn" matched 3 elements; clicks require a unique target.',
      hint: 'Pass --nth <n> to pick one (0-based).',
      matches_n: 3,
    }));
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '.btn']);

    const err = lastJsonLog().error;
    expect(err.code).toBe('selector_ambiguous');
    expect(err.matches_n).toBe(3);
    expect(process.exitCode).toBeDefined();
  });

  it('surfaces selector_nth_out_of_range from page.click as an error envelope', async () => {
    (browserState.page!.click as any).mockRejectedValueOnce(new TargetError({
      code: 'selector_nth_out_of_range',
      message: '--nth 99 is out of range for CSS selector ".btn" (matches_n=3).',
      hint: 'Pick an index in [0, 2].',
      matches_n: 3,
    }));
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '.btn', '--nth', '99']);

    expect(lastJsonLog().error.code).toBe('selector_nth_out_of_range');
    expect(process.exitCode).toBeDefined();
  });

  it('rejects malformed --nth on click with usage_error before touching the page', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'click', '.btn', '--nth', 'abc']);

    expect(lastJsonLog().error.code).toBe('usage_error');
    expect(browserState.page!.click).not.toHaveBeenCalled();
    expect(process.exitCode).toBeDefined();
  });

  it('type: clicks, waits, then typeText — emits {typed, text, target, matches_n, match_level, autocomplete}', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'exact' });
    (browserState.page!.typeText as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'exact' });
    (browserState.page!.evaluate as any).mockResolvedValueOnce(false); // isAutocomplete
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'type', '#q', 'hello']);

    expect(browserState.page!.click).toHaveBeenCalledWith('#q', {});
    expect(browserState.page!.wait).toHaveBeenCalledWith(0.3);
    expect(browserState.page!.typeText).toHaveBeenCalledWith('#q', 'hello', {});
    expect(lastJsonLog()).toEqual({
      typed: true, text: 'hello', target: '#q', matches_n: 1, match_level: 'exact', autocomplete: false,
    });
  });

  it('type: waits an extra 0.4s when the input reports autocomplete=true', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'exact' });
    (browserState.page!.typeText as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'exact' });
    (browserState.page!.evaluate as any).mockResolvedValueOnce(true);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'type', '#q', 'hi']);

    const waitCalls = (browserState.page!.wait as any).mock.calls;
    expect(waitCalls).toContainEqual([0.3]);
    expect(waitCalls).toContainEqual([0.4]);
    expect(lastJsonLog().autocomplete).toBe(true);
    expect(lastJsonLog().match_level).toBe('exact');
  });

  it('type: surfaces match_level=reidentified when ref had to be reidentified by fingerprint', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'reidentified' });
    (browserState.page!.typeText as any).mockResolvedValueOnce({ matches_n: 1, match_level: 'reidentified' });
    (browserState.page!.evaluate as any).mockResolvedValueOnce(false);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'type', '9', 'hi']);

    // The typeText call is the authoritative match_level source for the `type` envelope.
    expect(lastJsonLog().match_level).toBe('reidentified');
  });

  it('type: forwards --nth to both click and typeText', async () => {
    (browserState.page!.click as any).mockResolvedValueOnce({ matches_n: 5, match_level: 'exact' });
    (browserState.page!.typeText as any).mockResolvedValueOnce({ matches_n: 5, match_level: 'exact' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'type', '.field', 'x', '--nth', '3']);

    expect(browserState.page!.click).toHaveBeenCalledWith('.field', { nth: 3 });
    expect(browserState.page!.typeText).toHaveBeenCalledWith('.field', 'x', { nth: 3 });
  });
});

describe('browser select command', () => {
  const { lastJsonLog } = installSelectorFirstTestHarness('select', () => ({
    evaluate: vi.fn(),
  }));

  it('emits {selected, target, matches_n, match_level} on success', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 1, match_level: 'exact' });
    evalMock.mockResolvedValueOnce({ selected: 'US' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'select', '#country', 'US']);

    expect(lastJsonLog()).toEqual({ selected: 'US', target: '#country', matches_n: 1, match_level: 'exact' });
  });

  it('maps "Not a <select>" to a not_a_select error envelope', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 1, match_level: 'exact' });
    evalMock.mockResolvedValueOnce({ error: 'Not a <select>' });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'select', '#not-select', 'US']);

    const err = lastJsonLog().error;
    expect(err.code).toBe('not_a_select');
    expect(err.matches_n).toBe(1);
    expect(process.exitCode).toBeDefined();
  });

  it('maps missing-option failures to an option_not_found envelope with available list', async () => {
    const evalMock = browserState.page!.evaluate as any;
    evalMock.mockResolvedValueOnce({ ok: true, matches_n: 1, match_level: 'exact' });
    evalMock.mockResolvedValueOnce({ error: 'Option "XX" not found', available: ['US', 'CA'] });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'select', '#country', 'XX']);

    const err = lastJsonLog().error;
    expect(err.code).toBe('option_not_found');
    expect(err.available).toEqual(['US', 'CA']);
    expect(process.exitCode).toBeDefined();
  });

  it('surfaces selector_ambiguous from the resolver before calling selectResolvedJs', async () => {
    (browserState.page!.evaluate as any).mockResolvedValueOnce({
      ok: false,
      code: 'selector_ambiguous',
      message: 'CSS selector ".dropdown" matched 2 elements.',
      hint: 'Pass --nth <n>.',
      matches_n: 2,
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'browser', 'select', '.dropdown', 'US']);

    expect(lastJsonLog().error.code).toBe('selector_ambiguous');
    // The select payload JS must not fire when resolution fails
    expect((browserState.page!.evaluate as any).mock.calls).toHaveLength(1);
    expect(process.exitCode).toBeDefined();
  });
});

describe('findPackageRoot', () => {
  it('walks up from dist/src to the package root', () => {
    const packageRoot = path.join('repo-root');
    const cliFile = path.join(packageRoot, 'dist', 'src', 'cli.js');
    const exists = new Set([
      path.join(packageRoot, 'package.json'),
    ]);

    expect(findPackageRoot(cliFile, (candidate) => exists.has(candidate))).toBe(packageRoot);
  });

  it('walks up from src to the package root', () => {
    const packageRoot = path.join('repo-root');
    const cliFile = path.join(packageRoot, 'src', 'cli.ts');
    const exists = new Set([
      path.join(packageRoot, 'package.json'),
    ]);

    expect(findPackageRoot(cliFile, (candidate) => exists.has(candidate))).toBe(packageRoot);
  });
});

describe('normalizeVerifyRows', () => {
  it('returns an empty array for null / primitives', () => {
    expect(normalizeVerifyRows(null)).toEqual([]);
    expect(normalizeVerifyRows(undefined)).toEqual([]);
    expect(normalizeVerifyRows('hello')).toEqual([]);
  });

  it('passes through array-of-objects', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(normalizeVerifyRows(rows)).toEqual(rows);
  });

  it('wraps array-of-primitives as { value } rows', () => {
    expect(normalizeVerifyRows([1, 'two', null])).toEqual([
      { value: 1 }, { value: 'two' }, { value: null },
    ]);
  });

  it('unwraps common envelope shapes', () => {
    expect(normalizeVerifyRows({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(normalizeVerifyRows({ items: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(normalizeVerifyRows({ data: [{ c: 3 }] })).toEqual([{ c: 3 }]);
    expect(normalizeVerifyRows({ results: [{ d: 4 }] })).toEqual([{ d: 4 }]);
  });

  it('wraps a single object as a one-row array', () => {
    expect(normalizeVerifyRows({ ok: true })).toEqual([{ ok: true }]);
  });
});

describe('renderVerifyPreview', () => {
  it('emits a placeholder for empty rows', () => {
    expect(renderVerifyPreview([])).toContain('no rows');
  });

  it('prints column headers followed by row cells', () => {
    const out = renderVerifyPreview([{ a: 'x', b: 1 }, { a: 'y', b: 2 }]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('a');
    expect(lines[0]).toContain('b');
    expect(lines.some((l) => l.includes('x') && l.includes('1'))).toBe(true);
    expect(lines.some((l) => l.includes('y') && l.includes('2'))).toBe(true);
  });

  it('truncates long cells and reports hidden rows / columns', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      a: i, b: 'x'.repeat(100), c: i, d: i, e: i, f: i, g: i, h: i,
    }));
    const out = renderVerifyPreview(rows, { maxRows: 5, maxCols: 3, cellMax: 10 });
    expect(out).toContain('and 10 more row');
    expect(out).toContain('more column');
    // cell gets truncated
    expect(out).toContain('xxxxxxxxxx');
    expect(out).not.toContain('xxxxxxxxxxx'); // never 11 consecutive
  });
});
