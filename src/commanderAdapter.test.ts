import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { CliCommand } from './registry.js';

const { mockExecuteCommand, mockRenderOutput } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn(),
  mockRenderOutput: vi.fn(),
}));

vi.mock('./execution.js', () => ({
  executeCommand: mockExecuteCommand,
}));

vi.mock('./output.js', () => ({
  render: mockRenderOutput,
}));

import { registerCommandToProgram } from './commanderAdapter.js';

describe('commanderAdapter bool normalization', () => {
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

  it('normalizes explicit false string values to false', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--dry-run', 'false']);

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      cmd,
      expect.objectContaining({
        pdf: './paper.pdf',
        'dry-run': false,
        'prepare-only': false,
      }),
      false,
    );
  });

  it('normalizes valueless bool flags to true', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--prepare-only']);

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      cmd,
      expect.objectContaining({
        pdf: './paper.pdf',
        'dry-run': false,
        'prepare-only': true,
      }),
      false,
    );
  });

  it('rejects invalid bool strings before execution', async () => {
    const program = new Command();
    const siteCmd = program.command('paperreview');
    registerCommandToProgram(siteCmd, cmd);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    await program.parseAsync(['node', 'opencli', 'paperreview', 'submit', './paper.pdf', '--dry-run', 'maybe']);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"dry-run" must be either "true" or "false".'));

    stderr.mockRestore();
  });
});
