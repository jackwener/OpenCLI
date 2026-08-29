import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { CliCommand } from './registry.js';
import { attachTraceReceipt, EmptyResultError, selectorError } from './errors.js';

const { mockExecuteCommand, mockRenderOutput } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn(),
  mockRenderOutput: vi.fn(),
}));

vi.mock('./execution.js', async () => {
  const actual = await vi.importActual<typeof import('./execution.js')>('./execution.js');
  return {
    ...actual,
    executeCommand: mockExecuteCommand,
  };
});

vi.mock('./output.js', () => ({
  render: mockRenderOutput,
}));

import { registerCommandToProgram } from './commanderAdapter.js';
import { resolveArgShort } from './arg-short.js';

describe('commanderAdapter arg passing', () => {
  const cmd: CliCommand = {
    site: 'paperreview',
    name: 'submit', access: 'read',
    description: 'Submit a PDF',
    browser: false,
    args: [
      { name: 'pdf', positional: true, required: true, help: 'Path to the paper PDF' },
      { name: 'dry-run', type: 'bool', default: false, help: 'Validate only' },
      { name: 'prepare-only', type: 'bool', default: false, help: 'Prepare only' },
    ],
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('passes bool flag values through to executeCommand for coercion', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--dry-run', 'false']);

    expect(mockExecuteCommand).toHaveBeenCalled();
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.pdf).toBe('./paper.pdf');
    expect(kwargs).toHaveProperty('dry-run');
  });

  it('passes valueless bool flags as true to executeCommand', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--prepare-only']);

    expect(mockExecuteCommand).toHaveBeenCalled();
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.pdf).toBe('./paper.pdf');
    expect(kwargs['prepare-only']).toBe(true);
  });

  it('passes option value sources through for adapters that need explicit-vs-default semantics', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--prepare-only']);

    expect(mockExecuteCommand).toHaveBeenCalled();
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.__opencliOptionSources).toMatchObject({
      'prepare-only': 'cli',
    });
  });

  it('passes explicit trace mode to executeCommand', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--trace', 'retain-on-failure']);

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'paperreview', name: 'submit' }),
      expect.objectContaining({ pdf: './paper.pdf' }),
      false,
      { prepared: true, trace: 'retain-on-failure' },
    );
  });

  it('rejects invalid bool values before calling executeCommand', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--dry-run', 'maybe']);

    // prepareCommandArgs validates bools before dispatch; executeCommand should not be reached
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});

describe('resolveArgShort', () => {
  it('accepts a single ASCII letter and claims it', () => {
    const used = new Set<string>();
    expect(resolveArgShort('l', used)).toBe('l');
    expect(used.has('l')).toBe(true);
  });

  it('rejects reserved global shorts, duplicates, and non-single-letter values', () => {
    const used = new Set(['f', 'v', 'h']); // as seeded per command
    expect(resolveArgShort('f', used)).toBeUndefined(); // reserved -f/--format
    expect(resolveArgShort('v', used)).toBeUndefined(); // reserved -v/--verbose
    expect(resolveArgShort('lo', used)).toBeUndefined(); // multi-char
    expect(resolveArgShort('1', used)).toBeUndefined(); // not a letter
    expect(resolveArgShort('', used)).toBeUndefined();
    expect(resolveArgShort(undefined, used)).toBeUndefined();
    // first declaration wins; a later duplicate degrades to long-only
    expect(resolveArgShort('x', used)).toBe('x');
    expect(resolveArgShort('x', used)).toBeUndefined();
    // case-sensitive: -F is distinct from the reserved -f
    expect(resolveArgShort('F', used)).toBe('F');
  });
});

describe('commanderAdapter short option aliases', () => {
  const cmd: CliCommand = {
    site: 'demo',
    name: 'list', access: 'read',
    description: 'List things',
    browser: false,
    args: [
      { name: 'limit', short: 'l', type: 'int', default: 20, help: 'Max items' },
      { name: 'output', short: 'o', type: 'str', help: 'Output file' },
    ],
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    process.exitCode = undefined;
  });

  it('populates the canonical kwargs key from the short form', async () => {
    const program = new Command();
    registerCommandToProgram(program.command('demo'), cmd);
    await program.parseAsync(['node', 'opencli', 'demo', 'list', '-l', '10', '-o', 'out.json']);
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(Number(kwargs.limit)).toBe(10); // int arg is coerced; short and long agree on the value
    expect(kwargs.output).toBe('out.json');
  });

  it('populates the same key from the long form', async () => {
    const program = new Command();
    registerCommandToProgram(program.command('demo'), cmd);
    await program.parseAsync(['node', 'opencli', 'demo', 'list', '--limit', '10', '--output', 'out.json']);
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(Number(kwargs.limit)).toBe(10); // int arg is coerced; short and long agree on the value
    expect(kwargs.output).toBe('out.json');
  });

  it('skips a short that collides with a reserved flag without breaking registration or -f', async () => {
    const clashCmd: CliCommand = {
      site: 'demo', name: 'run', access: 'read', description: 'Run', browser: false,
      args: [{ name: 'foo', short: 'f', type: 'str', help: 'Foo' }], // 'f' is reserved by --format
      func: vi.fn(),
    };
    const program = new Command();
    // Registration must not throw on the reserved-short collision.
    expect(() => registerCommandToProgram(program.command('demo'), clashCmd)).not.toThrow();
    await program.parseAsync(['node', 'opencli', 'demo', 'run', '--foo', 'bar', '-f', 'json']);
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.foo).toBe('bar'); // long form still works; -f stayed with --format
  });

  it('gives the short to the first arg and degrades a duplicate to long-only', async () => {
    const dupCmd: CliCommand = {
      site: 'demo', name: 'dup', access: 'read', description: 'Dup', browser: false,
      args: [
        { name: 'aa', short: 'x', type: 'str', help: 'A' },
        { name: 'bb', short: 'x', type: 'str', help: 'B' },
      ],
      func: vi.fn(),
    };
    const program = new Command();
    expect(() => registerCommandToProgram(program.command('demo'), dupCmd)).not.toThrow();
    await program.parseAsync(['node', 'opencli', 'demo', 'dup', '-x', '1', '--bb', '2']);
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.aa).toBe('1'); // -x bound to the first declaration
    expect(kwargs.bb).toBe('2'); // second still reachable via its long flag
  });
});

describe('commanderAdapter boolean alias support', () => {
  const cmd: CliCommand = {
    site: 'reddit',
    name: 'save', access: 'read',
    description: 'Save a post',
    browser: false,
    args: [
      { name: 'post-id', positional: true, required: true, help: 'Post ID' },
      { name: 'undo', type: 'boolean', default: false, help: 'Unsave instead of save' },
    ],
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('coerces default false for boolean args to a real boolean', async () => {
    const program = new Command();
    const siteCmd = program.command('reddit');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'reddit', 'save', 't3_abc123']);

    expect(mockExecuteCommand).toHaveBeenCalled();
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs['post-id']).toBe('t3_abc123');
    expect(kwargs.undo).toBe(false);
  });

  it('coerces explicit false for boolean args to a real boolean', async () => {
    const program = new Command();
    const siteCmd = program.command('reddit');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'reddit', 'save', 't3_abc123', '--undo', 'false']);

    expect(mockExecuteCommand).toHaveBeenCalled();
    const kwargs = mockExecuteCommand.mock.calls[0][1];
    expect(kwargs.undo).toBe(false);
  });
});

describe('commanderAdapter value-required optional options', () => {
  const cmd: CliCommand = {
    site: 'instagram',
    name: 'post', access: 'read',
    description: 'Post to Instagram',
    browser: true,
    args: [
      { name: 'image', valueRequired: true, help: 'Single image path' },
      { name: 'images', valueRequired: true, help: 'Comma-separated image paths' },
      { name: 'content', positional: true, required: false, help: 'Caption text' },
    ],
    validateArgs: (kwargs) => {
      if (!kwargs.image && !kwargs.images) {
        throw new Error('media required');
      }
    },
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('requires a value when --image is present', async () => {
    const program = new Command();
    program.exitOverride();
    const siteCmd = program.command('instagram');
    registerCommandToProgram(siteCmd, cmd);

    await expect(
      program.parseAsync(['node', 'opencli', 'instagram', 'post', '--image']),
    ).rejects.toMatchObject({ code: 'commander.optionMissingArgument' });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it('runs validateArgs before executeCommand so missing media does not dispatch the browser command', async () => {
    const program = new Command();
    const siteCmd = program.command('instagram');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'instagram', 'post', 'caption only']);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBeDefined();
  });
});

describe('commanderAdapter command aliases', () => {
  const cmd: CliCommand = {
    site: 'notebooklm',
    name: 'get',
    access: 'read',
    aliases: ['metadata'],
    description: 'Get notebook metadata',
    browser: false,
    args: [],
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('registers aliases with Commander so compatibility names execute the same command', async () => {
    const program = new Command();
    const siteCmd = program.command('notebooklm');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'notebooklm', 'metadata']);

    expect(mockExecuteCommand).toHaveBeenCalledWith(cmd, {}, false, { prepared: true });
  });
});

describe('commanderAdapter validation preparation', () => {
  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('prepares args once before dispatching to executeCommand', async () => {
    const validateArgs = vi.fn();
    const program = new Command();
    const siteCmd = program.command('test');

    registerCommandToProgram(siteCmd, {
      site: 'test',
      name: 'run', access: 'read',
      description: 'Run test command',
      browser: false,
      args: [{ name: 'count', default: '1', help: 'Count' }],
      validateArgs,
      func: vi.fn(),
    });

    await program.parseAsync(['node', 'opencli', 'test', 'run']);

    expect(validateArgs).toHaveBeenCalledTimes(1);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'test', name: 'run' }),
      { count: '1' },
      false,
      { prepared: true },
    );
  });
});

describe('commanderAdapter default formats', () => {
  const cmd: CliCommand = {
    site: 'gemini',
    name: 'ask', access: 'read',
    description: 'Ask Gemini',
    browser: false,
    args: [],
    columns: ['response'],
    defaultFormat: 'plain',
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue([{ response: 'hello' }]);
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('uses the command defaultFormat when the user keeps the default table format', async () => {
    const program = new Command();
    const siteCmd = program.command('gemini');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'gemini', 'ask']);

    expect(mockRenderOutput).toHaveBeenCalledWith(
      [{ response: 'hello' }],
      expect.objectContaining({ fmt: 'plain' }),
    );
  });

  it('respects an explicit user format over the command defaultFormat', async () => {
    const program = new Command();
    const siteCmd = program.command('gemini');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'gemini', 'ask', '--format', 'json']);

    expect(mockRenderOutput).toHaveBeenCalledWith(
      [{ response: 'hello' }],
      expect.objectContaining({ fmt: 'json' }),
    );
  });
});

describe('commanderAdapter error envelope output', () => {
  const cmd: CliCommand = {
    site: 'xiaohongshu',
    name: 'note', access: 'read',
    description: 'Read one note',
    browser: false,
    args: [
      { name: 'note-id', positional: true, required: true, help: 'Note ID' },
    ],
    func: vi.fn(),
  };

  beforeEach(() => {
    mockExecuteCommand.mockReset();
    mockRenderOutput.mockReset();
    delete process.env.OPENCLI_VERBOSE;
    process.exitCode = undefined;
  });

  it('outputs YAML error envelope with adapter hint to stderr', async () => {
    const program = new Command();
    const siteCmd = program.command('xiaohongshu');
    registerCommandToProgram(siteCmd, cmd);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockExecuteCommand.mockRejectedValueOnce(
      new EmptyResultError(
        'xiaohongshu/note',
        'Pass the full search_result URL with xsec_token instead of a bare note ID.',
      ),
    );

    await program.parseAsync(['node', 'opencli', 'xiaohongshu', 'note', '69ca3927000000001a020fd5']);

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('ok: false');
    expect(output).toContain('code: EMPTY_RESULT');
    expect(output).toContain('xsec_token');
    expect(output).toContain('--trace=retain-on-failure');
    expect(output).toContain('opencli xiaohongshu note --trace retain-on-failure');

    stderrSpy.mockRestore();
  });

  it('outputs YAML error envelope for selector errors', async () => {
    const program = new Command();
    const siteCmd = program.command('xiaohongshu');
    registerCommandToProgram(siteCmd, cmd);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockExecuteCommand.mockRejectedValueOnce(
      selectorError('.note-title', 'The note title selector no longer matches the current page.'),
    );

    await program.parseAsync(['node', 'opencli', 'xiaohongshu', 'note', '69ca3927000000001a020fd5']);

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('ok: false');
    expect(output).toContain('code: SELECTOR');
    expect(output).toContain('selector no longer matches');
    expect(output).toContain('--trace=retain-on-failure');

    stderrSpy.mockRestore();
  });

  it('does not add an AutoFix rerun hint when trace is already enabled', async () => {
    const program = new Command();
    const siteCmd = program.command('xiaohongshu');
    registerCommandToProgram(siteCmd, cmd);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockExecuteCommand.mockRejectedValueOnce(selectorError('.note-title'));

    await program.parseAsync([
      'node',
      'opencli',
      'xiaohongshu',
      'note',
      '69ca3927000000001a020fd5',
      '--trace',
      'retain-on-failure',
    ]);

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('code: SELECTOR');
    expect(output).not.toContain('AutoFix: re-run');

    stderrSpy.mockRestore();
  });

  it('includes trace metadata from the error envelope when execution attached it', async () => {
    const program = new Command();
    const siteCmd = program.command('xiaohongshu');
    registerCommandToProgram(siteCmd, cmd);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const err = selectorError('.note-title');
    attachTraceReceipt(err, {
      schemaVersion: 1,
      opencliVersion: '1.7.8',
      traceId: 'trace-1',
      traceDir: '/tmp/opencli/profiles/default/traces/trace-1',
      summaryPath: '/tmp/opencli/profiles/default/traces/trace-1/summary.md',
      receiptPath: '/tmp/opencli/profiles/default/traces/trace-1/receipt.json',
      status: 'failure',
      createdAt: '2026-05-03T00:00:00.000Z',
      error: { code: 'SELECTOR', message: 'Could not find element: .note-title' },
    });
    mockExecuteCommand.mockRejectedValueOnce(err);

    await program.parseAsync([
      'node',
      'opencli',
      'xiaohongshu',
      'note',
      '69ca3927000000001a020fd5',
      '--trace',
      'retain-on-failure',
    ]);

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('trace:');
    expect(output).toContain('dir: /tmp/opencli/profiles/default/traces/trace-1');
    expect(output).toContain('summaryPath: /tmp/opencli/profiles/default/traces/trace-1/summary.md');
    expect(output).toContain('receiptPath: /tmp/opencli/profiles/default/traces/trace-1/receipt.json');

    stderrSpy.mockRestore();
  });
});
