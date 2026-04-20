import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from './types.js';

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

import { createProgram, findPackageRoot, resolveBrowserVerifyInvocation } from './cli.js';

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
