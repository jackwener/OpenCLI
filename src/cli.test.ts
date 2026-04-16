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

describe('browser network snapshot caching', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = undefined;
    const tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-network-cache-'));
    process.env.OPENCLI_CACHE_DIR = tempCacheDir;
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it('reuses the last listed snapshot for --detail without consuming a new capture batch', async () => {
    const readNetworkCapture = vi.fn().mockResolvedValueOnce([
      {
        url: 'https://api.example.com/items',
        method: 'GET',
        responseStatus: 200,
        responseContentType: 'application/json',
        responsePreview: JSON.stringify({ items: [{ id: 1, title: 'cached item' }] }),
      },
    ]);
    browserState.page = {
      evaluate: vi.fn(),
      readNetworkCapture,
    } as unknown as IPage;

    await createProgram('', '').parseAsync(['node', 'opencli', 'browser', 'network']);
    await createProgram('', '').parseAsync(['node', 'opencli', 'browser', 'network', '--detail', '0']);

    expect(readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('Showing cached request [0]');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('https://api.example.com/items');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('cached item');
  });

  it('reports an out-of-range detail index against the last listed snapshot', async () => {
    const readNetworkCapture = vi.fn().mockResolvedValueOnce([
      {
        url: 'https://api.example.com/items',
        method: 'GET',
        responseStatus: 200,
        responseContentType: 'application/json',
        responsePreview: JSON.stringify({ ok: true }),
      },
    ]);
    browserState.page = {
      evaluate: vi.fn(),
      readNetworkCapture,
    } as unknown as IPage;

    await createProgram('', '').parseAsync(['node', 'opencli', 'browser', 'network']);
    await createProgram('', '').parseAsync(['node', 'opencli', 'browser', 'network', '--detail', '9']);

    expect(readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeDefined();
    expect(consoleErrorSpy.mock.calls.flat().join('\n')).toContain('not found in the last "browser network" result');
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
