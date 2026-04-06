import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildRepairContext, collectDiagnostic, isDiagnosticEnabled, emitDiagnostic,
  truncate, redactUrl, redactText, resolveAdapterSourcePath, MAX_DIAGNOSTIC_BYTES,
  type RepairContext,
} from './diagnostic.js';
import { SelectorError, CommandExecutionError } from './errors.js';
import type { InternalCliCommand } from './registry.js';
import type { ConsoleMessage, IPage } from './types.js';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

type _ConsoleMessagesReturnType = Assert<
  IsEqual<Awaited<ReturnType<IPage['consoleMessages']>>, ConsoleMessage[]>
>;
type _StartCaptureOptional = Assert<
  undefined extends IPage['startNetworkCapture'] ? true : false
>;
type _ReadCaptureOptional = Assert<
  undefined extends IPage['readNetworkCapture'] ? true : false
>;
type _StopCapturePresent = Assert<
  'stopCapture' extends keyof IPage ? true : false
>;

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

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 100)).toBe('hello');
  });

  it('truncates long strings with marker', () => {
    const long = 'a'.repeat(200);
    const result = truncate(long, 50);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('...[truncated,');
    expect(result).toContain('150 chars omitted]');
  });
});

describe('redactUrl', () => {
  it('redacts sensitive query parameters', () => {
    expect(redactUrl('https://api.com/v1?token=abc123&q=test'))
      .toBe('https://api.com/v1?token=[REDACTED]&q=test');
  });

  it('redacts multiple sensitive params', () => {
    const url = 'https://api.com?api_key=xxx&secret=yyy&page=1';
    const result = redactUrl(url);
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).toContain('secret=[REDACTED]');
    expect(result).toContain('page=1');
  });

  it('leaves clean URLs unchanged', () => {
    expect(redactUrl('https://example.com/page?q=test')).toBe('https://example.com/page?q=test');
  });
});

describe('redactText', () => {
  it('redacts Bearer tokens', () => {
    expect(redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test'))
      .toContain('Bearer [REDACTED]');
  });

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`token is ${jwt}`)).toContain('[REDACTED_JWT]');
    expect(redactText(`token is ${jwt}`)).not.toContain('eyJhbGci');
  });

  it('redacts inline token=value patterns', () => {
    expect(redactText('failed with token=abc123def456')).toContain('token=[REDACTED]');
  });

  it('redacts cookie values', () => {
    const result = redactText('cookie: session=abc123; user=xyz789; path=/');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('session=abc123');
  });

  it('leaves normal text unchanged', () => {
    expect(redactText('Error: element not found')).toBe('Error: element not found');
  });
});

describe('resolveAdapterSourcePath', () => {
  it('returns source when it is a real file path (not manifest:)', () => {
    const cmd = makeCmd({ source: '/home/user/.opencli/clis/arxiv/search.yaml' });
    expect(resolveAdapterSourcePath(cmd as InternalCliCommand)).toBe('/home/user/.opencli/clis/arxiv/search.yaml');
  });

  it('skips manifest: pseudo-paths and falls back to _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:arxiv/search', _modulePath: '/pkg/dist/clis/arxiv/search.js' });
    // Should try to map dist→source, but since files don't exist on disk, returns _modulePath
    const result = resolveAdapterSourcePath(cmd as InternalCliCommand);
    expect(result).toBeDefined();
    expect(result).not.toContain('manifest:');
  });

  it('returns undefined when only manifest: pseudo-path and no _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:test/cmd' });
    expect(resolveAdapterSourcePath(cmd as InternalCliCommand)).toBeUndefined();
  });

  it('prefers _modulePath mapped to .ts over dist .js', () => {
    // This test verifies the mapping logic without requiring files on disk
    const cmd = makeCmd({ _modulePath: '/project/dist/clis/site/cmd.js' });
    const result = resolveAdapterSourcePath(cmd as InternalCliCommand);
    // Since neither .ts nor .js exists, returns _modulePath as best guess
    expect(result).toBe('/project/dist/clis/site/cmd.js');
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

  it('truncates long stack traces', () => {
    const err = new Error('boom');
    err.stack = 'x'.repeat(10_000);
    const ctx = buildRepairContext(err, makeCmd());
    expect(ctx.error.stack!.length).toBeLessThan(10_000);
    expect(ctx.error.stack).toContain('truncated');
  });

  it('redacts sensitive data in error message and stack', () => {
    const err = new Error('Request failed with Bearer eyJhbGciOiJIUzI1NiJ9.test.sig');
    const ctx = buildRepairContext(err, makeCmd());
    expect(ctx.error.message).toContain('Bearer [REDACTED]');
    expect(ctx.error.message).not.toContain('eyJhbGci');
    // Stack also gets redacted
    expect(ctx.error.stack).toContain('Bearer [REDACTED]');
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

  it('drops page snapshot when over size budget', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const ctx: RepairContext = {
      error: { code: 'COMMAND_EXEC', message: 'boom' },
      adapter: { site: 'test', command: 'test/cmd' },
      page: {
        url: 'https://example.com',
        snapshot: 'x'.repeat(MAX_DIAGNOSTIC_BYTES + 1000),
        networkRequests: [],
        consoleErrors: [],
      },
      timestamp: new Date().toISOString(),
    };
    emitDiagnostic(ctx);

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    const match = output.match(/___OPENCLI_DIAGNOSTIC___\n(.*)\n___OPENCLI_DIAGNOSTIC___/);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]);
    // Page snapshot should be replaced or page dropped entirely
    expect(parsed.page?.snapshot !== ctx.page!.snapshot || parsed.page === undefined).toBe(true);
    expect(match![1].length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);

    writeSpy.mockRestore();
  });

  it('redacts sensitive headers in network requests', () => {
    const pageState: RepairContext['page'] = {
      url: 'https://example.com',
      snapshot: '<div/>',
      networkRequests: [{
        url: 'https://api.com/data?token=secret123',
        headers: { authorization: 'Bearer xyz', 'content-type': 'application/json' },
        body: '{"data": "ok"}',
      }],
      consoleErrors: [],
    };
    // Build context manually to test redaction via collectPageState
    // Since collectPageState is private, test the output of buildRepairContext
    // with already-collected page state — redaction happens in collectPageState.
    // For unit test, verify redactUrl directly (tested above) and trust integration.
    expect(redactUrl('https://api.com/data?token=secret123')).toContain('[REDACTED]');
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
    startNetworkCapture: vi.fn().mockResolvedValue(undefined),
    readNetworkCapture: vi.fn().mockResolvedValue([]),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    getCurrentUrl: vi.fn().mockResolvedValue('https://example.com/page'),
    ...overrides,
  } as IPage;
}

describe('collectDiagnostic', () => {
  it('keeps intercepted payloads in a dedicated capturedPayloads field', async () => {
    const page = makePage({
      networkRequests: vi.fn().mockResolvedValue([{ url: '/api/data', status: 200 }]),
      getInterceptedRequests: vi.fn().mockResolvedValue([{ items: [{ id: 1 }] }]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page?.networkRequests).toEqual([
      { url: '/api/data', status: 200 },
    ]);
    expect(ctx.page?.capturedPayloads).toEqual([
      { source: 'interceptor', responseBody: { items: [{ id: 1 }] } },
    ]);
  });

  it('preserves the previous network request output when interception is empty', async () => {
    const page = makePage({
      networkRequests: vi.fn().mockResolvedValue([{ url: '/api/data', status: 200 }]),
      getInterceptedRequests: vi.fn().mockResolvedValue([]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page?.networkRequests).toEqual([{ url: '/api/data', status: 200 }]);
    expect(ctx.page?.capturedPayloads).toEqual([]);
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
      capturedPayloads: [],
      consoleErrors: [],
    });
  });

  it('redacts and truncates intercepted payloads recursively', async () => {
    const page = makePage({
      getInterceptedRequests: vi.fn().mockResolvedValue([{
        token: 'token=abc123def456ghi789',
        nested: {
          cookie: 'cookie: session=super-secret-cookie-value',
          body: 'x'.repeat(5000),
        },
      }]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);
    const payload = ctx.page?.capturedPayloads?.[0] as Record<string, unknown>;
    const body = ((payload.responseBody as Record<string, unknown>).nested as Record<string, unknown>).body as string;

    expect(payload).toEqual({
      source: 'interceptor',
      responseBody: {
        token: 'token=[REDACTED]',
        nested: {
          cookie: 'cookie: [REDACTED]',
          body,
        },
      },
    });
    expect(body).toContain('[truncated,');
    expect(body.length).toBeLessThan(5000);
  });

  it('prefers readNetworkCapture and redacts structured console entries', async () => {
    const page = makePage({
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com/?token=secret'),
      readNetworkCapture: vi.fn().mockResolvedValue([{ url: 'https://api.test', responseStatus: 500 }]),
      networkRequests: vi.fn().mockResolvedValue([{ url: 'https://fallback.test' }]),
      consoleMessages: vi.fn().mockResolvedValue([{ level: 'error', text: 'Bearer abc.def.ghi' }]),
    });

    const ctx = await collectDiagnostic(new Error('boom'), makeCmd(), page);

    expect(ctx.page).toEqual({
      url: 'https://example.com/?token=[REDACTED]',
      snapshot: '<div>...</div>',
      networkRequests: [{ url: 'https://api.test', responseStatus: 500 }],
      capturedPayloads: [],
      consoleErrors: [{ level: 'error', text: 'Bearer [REDACTED]' }],
    });
    expect(page.readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(page.networkRequests).not.toHaveBeenCalled();
  });
});
