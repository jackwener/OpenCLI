import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { CliCommand } from './registry.js';
import { EmptyResultError, selectorError } from './errors.js';

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

describe('commanderAdapter arg passing', () => {
  const cmd: CliCommand = {
    site: 'paperreview',
    name: 'submit',
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

  it('rejects invalid bool values before calling executeCommand', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--dry-run', 'maybe']);

    // prepareCommandArgs validates bools before dispatch; executeCommand should not be reached
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});

describe('commanderAdapter boolean alias support', () => {
  const cmd: CliCommand = {
    site: 'reddit',
    name: 'save',
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
    name: 'post',
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
      name: 'run',
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
    name: 'ask',
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
    name: 'note',
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

    stderrSpy.mockRestore();
  });
});
