import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from './types.js';

const {
  mockExploreUrl,
  mockRenderExploreSummary,
  mockGenerateVerifiedFromUrl,
  mockRenderGenerateVerifiedSummary,
  mockRecordSession,
  mockRenderRecordSummary,
  mockCascadeProbe,
  mockRenderCascadeResult,
  mockGetBrowserFactory,
  mockBrowserSession,
  mockBrowserConnect,
  mockBrowserClose,
  browserState,
} = vi.hoisted(() => ({
  mockExploreUrl: vi.fn(),
  mockRenderExploreSummary: vi.fn(),
  mockGenerateVerifiedFromUrl: vi.fn(),
  mockRenderGenerateVerifiedSummary: vi.fn(),
  mockRecordSession: vi.fn(),
  mockRenderRecordSummary: vi.fn(),
  mockCascadeProbe: vi.fn(),
  mockRenderCascadeResult: vi.fn(),
  mockGetBrowserFactory: vi.fn(() => ({ name: 'BrowserFactory' })),
  mockBrowserSession: vi.fn(),
  mockBrowserConnect: vi.fn(),
  mockBrowserClose: vi.fn(),
  browserState: { page: null as IPage | null },
}));

vi.mock('./explore.js', () => ({
  exploreUrl: mockExploreUrl,
  renderExploreSummary: mockRenderExploreSummary,
}));

vi.mock('./generate-verified.js', () => ({
  generateVerifiedFromUrl: mockGenerateVerifiedFromUrl,
  renderGenerateVerifiedSummary: mockRenderGenerateVerifiedSummary,
}));

vi.mock('./record.js', () => ({
  recordSession: mockRecordSession,
  renderRecordSummary: mockRenderRecordSummary,
}));

vi.mock('./cascade.js', () => ({
  cascadeProbe: mockCascadeProbe,
  renderCascadeResult: mockRenderCascadeResult,
}));

vi.mock('./runtime.js', () => ({
  getBrowserFactory: mockGetBrowserFactory,
  browserSession: mockBrowserSession,
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

describe('built-in browser commands verbose wiring', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    delete process.env.OPENCLI_VERBOSE;
    delete process.env.OPENCLI_CACHE_DIR;
    process.exitCode = undefined;
    vi.clearAllMocks();

    mockExploreUrl.mockReset().mockResolvedValue({ ok: true });
    mockRenderExploreSummary.mockReset().mockReturnValue('explore-summary');
    mockGenerateVerifiedFromUrl.mockReset().mockResolvedValue({ status: 'success' });
    mockRenderGenerateVerifiedSummary.mockReset().mockReturnValue('generate-summary');
    mockRecordSession.mockReset().mockResolvedValue({ candidateCount: 1 });
    mockRenderRecordSummary.mockReset().mockReturnValue('record-summary');
    mockCascadeProbe.mockReset().mockResolvedValue({ ok: true });
    mockRenderCascadeResult.mockReset().mockReturnValue('cascade-summary');
    mockGetBrowserFactory.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);
    mockBrowserSession.mockReset().mockImplementation(async (_factory, fn) => {
      const page = {
        goto: vi.fn(),
        wait: vi.fn(),
      } as unknown as IPage;
      return fn(page);
    });
    browserState.page = {
      evaluate: vi.fn(),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
    } as unknown as IPage;
  });

  it('enables OPENCLI_VERBOSE for explore via the real CLI command', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'explore', 'https://example.com', '-v']);

    expect(process.env.OPENCLI_VERBOSE).toBe('1');
    expect(mockExploreUrl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ workspace: 'explore:example.com' }),
    );
  });

  it('enables OPENCLI_VERBOSE for generate via the real CLI command', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'generate', 'https://example.com', '-v']);

    expect(process.env.OPENCLI_VERBOSE).toBe('1');
    expect(mockGenerateVerifiedFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com', workspace: 'generate:example.com', noRegister: false }),
    );
  });

  it('passes --no-register through the real CLI command', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'generate', 'https://example.com', '--no-register']);

    expect(mockGenerateVerifiedFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com', workspace: 'generate:example.com', noRegister: true }),
    );
  });

  it('enables OPENCLI_VERBOSE for record via the real CLI command', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'record', 'https://example.com', '-v']);

    expect(process.env.OPENCLI_VERBOSE).toBe('1');
    expect(mockRecordSession).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com' }),
    );
  });

  it('enables OPENCLI_VERBOSE for cascade via the real CLI command', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'cascade', 'https://example.com', '-v']);

    expect(process.env.OPENCLI_VERBOSE).toBe('1');
    expect(mockBrowserSession).toHaveBeenCalled();
    expect(mockCascadeProbe).toHaveBeenCalledWith(expect.any(Object), 'https://example.com');
  });

  it('leaves OPENCLI_VERBOSE unset when verbose is omitted', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'opencli', 'explore', 'https://example.com']);

    expect(process.env.OPENCLI_VERBOSE).toBeUndefined();
  });

  consoleLogSpy.mockClear();
});

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
