import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRepairContext, collectDiagnostic, isDiagnosticEnabled, emitDiagnostic, type RepairContext } from './diagnostic.js';
import { CliError, SelectorError, CommandExecutionError } from './errors.js';
import type { InternalCliCommand } from './registry.js';
import type { IPage } from './types.js';

function makeCmd(overrides: Partial<InternalCliCommand> = {}): InternalCliCommand {
  return {
    site: 'test-site',
    name: 'test-cmd',
    description: 'test',
    args: [],
    ...overrides,
  } as InternalCliCommand;
}

describe('isDiagnosticEnabled', () => {
  const origEnv = process.env.OPENCLI_DIAGNOSTIC;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.OPENCLI_DIAGNOSTIC;
    else process.env.OPENCLI_DIAGNOSTIC = origEnv;
  });

  it('returns false when env not set', () => {
    delete process.env.OPENCLI_DIAGNOSTIC;
    expect(isDiagnosticEnabled()).toBe(false);
  });

  it('returns true when env is "1"', () => {
    process.env.OPENCLI_DIAGNOSTIC = '1';
    expect(isDiagnosticEnabled()).toBe(true);
  });

  it('returns false for other values', () => {
    process.env.OPENCLI_DIAGNOSTIC = 'true';
    expect(isDiagnosticEnabled()).toBe(false);
  });
});

describe('buildRepairContext', () => {
  it('captures CliError fields', () => {
    const err = new SelectorError('.missing-element', 'Element removed');
    const ctx = buildRepairContext(err, makeCmd());

    expect(ctx.error.code).toBe('SELECTOR');
    expect(ctx.error.message).toContain('.missing-element');
    expect(ctx.error.hint).toBe('Element removed');
    expect(ctx.error.stack).toBeDefined();
    expect(ctx.adapter.site).toBe('test-site');
    expect(ctx.adapter.command).toBe('test-site/test-cmd');
    expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('handles non-CliError errors', () => {
    const err = new TypeError('Cannot read property "x" of undefined');
    const ctx = buildRepairContext(err, makeCmd());

    expect(ctx.error.code).toBe('UNKNOWN');
    expect(ctx.error.message).toContain('Cannot read property');
    expect(ctx.error.hint).toBeUndefined();
  });

  it('includes page state when provided', () => {
    const pageState: RepairContext['page'] = {
      url: 'https://example.com/page',
      snapshot: '<div>...</div>',
      networkRequests: [{ url: '/api/data', status: 200 }],
      consoleErrors: ['Uncaught TypeError'],
    };
    const ctx = buildRepairContext(new CommandExecutionError('boom'), makeCmd(), pageState);

    expect(ctx.page).toEqual(pageState);
  });

  it('omits page when not provided', () => {
    const ctx = buildRepairContext(new Error('boom'), makeCmd());
    expect(ctx.page).toBeUndefined();
  });
});

describe('emitDiagnostic', () => {
  it('writes delimited JSON to stderr', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const ctx = buildRepairContext(new CommandExecutionError('test error'), makeCmd());
    emitDiagnostic(ctx);

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('___OPENCLI_DIAGNOSTIC___');
    expect(output).toContain('"code":"COMMAND_EXEC"');
    expect(output).toContain('"message":"test error"');

    // Verify JSON is parseable between markers
    const match = output.match(/___OPENCLI_DIAGNOSTIC___\n(.*)\n___OPENCLI_DIAGNOSTIC___/);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]);
    expect(parsed.error.code).toBe('COMMAND_EXEC');

    writeSpy.mockRestore();
  });
});

function makePage(overrides: Partial<IPage> = {}): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn(),
    getCookies: vi.fn(),
    snapshot: vi.fn().mockResolvedValue('<div>...</div>'),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn(),
    wait: vi.fn(),
    tabs: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    waitForCapture: vi.fn(),
    screenshot: vi.fn(),
    getCurrentUrl: vi.fn().mockResolvedValue('https://example.com/page'),
    ...overrides,
  } as IPage;
}

describe('collectDiagnostic', () => {
  it('includes intercepted payloads ahead of network request entries', async () => {
    const page = makePage({
      networkRequests: vi.fn().mockResolvedValue([{ url: '/api/data', status: 200 }]),
      getInterceptedRequests: vi.fn().mockResolvedValue([{ items: [{ id: 1 }] }]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page?.networkRequests).toEqual([
      { source: 'interceptor', responseBody: { items: [{ id: 1 }] } },
      { url: '/api/data', status: 200 },
    ]);
  });

  it('preserves the previous network request output when interception is empty', async () => {
    const page = makePage({
      networkRequests: vi.fn().mockResolvedValue([{ url: '/api/data', status: 200 }]),
      getInterceptedRequests: vi.fn().mockResolvedValue([]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page?.networkRequests).toEqual([{ url: '/api/data', status: 200 }]);
  });

  it('swallows intercepted request failures and still returns page state', async () => {
    const page = makePage({
      networkRequests: vi.fn().mockResolvedValue([{ url: '/api/data', status: 200 }]),
      getInterceptedRequests: vi.fn().mockRejectedValue(new Error('interceptor unavailable')),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page).toEqual({
      url: 'https://example.com/page',
      snapshot: '<div>...</div>',
      networkRequests: [{ url: '/api/data', status: 200 }],
      consoleErrors: [],
    });
  });
});
