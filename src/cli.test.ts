import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from './types.js';

const {
  mockExploreUrl,
  mockRenderExploreSummary,
  mockGenerateCliFromUrl,
  mockRenderGenerateSummary,
  mockRecordSession,
  mockRenderRecordSummary,
  mockCascadeProbe,
  mockRenderCascadeResult,
  mockGetBrowserFactory,
  mockBrowserSession,
} = vi.hoisted(() => ({
  mockExploreUrl: vi.fn(),
  mockRenderExploreSummary: vi.fn(),
  mockGenerateCliFromUrl: vi.fn(),
  mockRenderGenerateSummary: vi.fn(),
  mockRecordSession: vi.fn(),
  mockRenderRecordSummary: vi.fn(),
  mockCascadeProbe: vi.fn(),
  mockRenderCascadeResult: vi.fn(),
  mockGetBrowserFactory: vi.fn(() => ({ name: 'BrowserFactory' })),
  mockBrowserSession: vi.fn(),
}));

vi.mock('./explore.js', () => ({
  exploreUrl: mockExploreUrl,
  renderExploreSummary: mockRenderExploreSummary,
}));

vi.mock('./generate.js', () => ({
  generateCliFromUrl: mockGenerateCliFromUrl,
  renderGenerateSummary: mockRenderGenerateSummary,
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

import { createProgram } from './cli.js';

describe('built-in browser commands verbose wiring', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;

    mockExploreUrl.mockReset().mockResolvedValue({ ok: true });
    mockRenderExploreSummary.mockReset().mockReturnValue('explore-summary');
    mockGenerateCliFromUrl.mockReset().mockResolvedValue({ ok: true });
    mockRenderGenerateSummary.mockReset().mockReturnValue('generate-summary');
    mockRecordSession.mockReset().mockResolvedValue({ candidateCount: 1 });
    mockRenderRecordSummary.mockReset().mockReturnValue('record-summary');
    mockCascadeProbe.mockReset().mockResolvedValue({ ok: true });
    mockRenderCascadeResult.mockReset().mockReturnValue('cascade-summary');
    mockGetBrowserFactory.mockClear();
    mockBrowserSession.mockReset().mockImplementation(async (_factory, fn) => {
      const page = {
        goto: vi.fn(),
        wait: vi.fn(),
      } as unknown as IPage;
      return fn(page);
    });
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
    expect(mockGenerateCliFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com', workspace: 'generate:example.com' }),
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
