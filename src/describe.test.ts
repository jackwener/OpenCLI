import { describe, it, expect, beforeAll } from 'vitest';
import { parseSubcommands, getCliHelp, describeTarget } from './describe.js';
import { cli, Strategy } from './registry.js';

beforeAll(() => {
  cli({
    site: 'test-describe',
    name: 'greet',
    description: 'Say hello',
    browser: false,
    strategy: Strategy.PUBLIC,
    domain: 'example.com',
    args: [
      { name: 'name', type: 'string', required: true, positional: true, help: 'Name to greet' },
      { name: 'lang', type: 'string', required: false, help: 'Language', choices: ['en', 'zh', 'ja'], default: 'en' },
    ],
    columns: ['message'],
    func: async () => [{ message: 'hello' }],
  });
  cli({
    site: 'test-describe',
    name: 'farewell',
    description: 'Say goodbye',
    browser: false,
    strategy: Strategy.PUBLIC,
    func: async () => [{ message: 'bye' }],
  });
});

describe('parseSubcommands', () => {
  it('parses Cobra-style help with trailing colons', () => {
    const help = `Work seamlessly with GitHub from the command line.

USAGE
  gh <command> <subcommand> [flags]

CORE COMMANDS
  browse:     Open the repository in the browser
  issue:      Manage issues
  pr:         Manage pull requests
  release:    Manage releases

ADDITIONAL COMMANDS
  alias:      Create command shortcuts
  api:        Make an authenticated GitHub API request

FLAGS
  --help    Show help for command`;

    const result = parseSubcommands(help);
    expect(result.length).toBe(6);
    // Trailing colons should be stripped
    expect(result[0]).toEqual({ name: 'browse', summary: 'Open the repository in the browser' });
    expect(result.some(s => s.name === 'alias')).toBe(true);
    // No colon in any name
    expect(result.every(s => !s.name.endsWith(':'))).toBe(true);
  });

  it('parses Click/Commander-style help', () => {
    const help = `Usage: mycli [OPTIONS] COMMAND [ARGS]...

Options:
  --version  Show version
  --help     Show this message and exit.

Commands:
  init     Create a new project
  run      Run the application
  test     Run tests`;

    const result = parseSubcommands(help);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ name: 'init', summary: 'Create a new project' });
    expect(result[1]).toEqual({ name: 'run', summary: 'Run the application' });
    expect(result[2]).toEqual({ name: 'test', summary: 'Run tests' });
  });

  it('parses Clap-style help (Rust)', () => {
    const help = `cargo 1.75.0

USAGE:
    cargo [+toolchain] [OPTIONS] [SUBCOMMAND]

SUBCOMMANDS:
    build    Compile the current package
    check    Analyze the current package
    clean    Remove generated artifacts
    doc      Build documentation`;

    const result = parseSubcommands(help);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ name: 'build', summary: 'Compile the current package' });
  });

  it('returns empty array for help with no commands section', () => {
    const help = `Usage: simple-tool [OPTIONS] FILE

Options:
  -v, --verbose    Enable verbose output
  -h, --help       Show this help message`;

    const result = parseSubcommands(help);
    expect(result).toEqual([]);
  });

  it('handles empty input', () => {
    expect(parseSubcommands('')).toEqual([]);
  });

  it('skips help and completion subcommands', () => {
    const help = `Commands:
  serve    Start the server
  help     Display help
  completion  Generate shell completions`;

    const result = parseSubcommands(help);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('serve');
  });

  it('deduplicates commands across sections', () => {
    const help = `COMMANDS
  foo    First
  bar    Second

MORE COMMANDS
  foo    First again
  baz    Third`;

    const result = parseSubcommands(help);
    expect(result.length).toBe(3);
    expect(result.map(s => s.name)).toEqual(['foo', 'bar', 'baz']);
  });
});

describe('getCliHelp', () => {
  it('returns help text for a known binary', () => {
    const help = getCliHelp('node');
    expect(help).not.toBeNull();
    expect(help!.length).toBeGreaterThan(0);
  });

  it('returns null for nonexistent binary', () => {
    const help = getCliHelp('__nonexistent_binary_12345__');
    expect(help).toBeNull();
  });

  it('passes subcommand args', () => {
    const help = getCliHelp('node', ['--version']);
    expect(typeof help === 'string' || help === null).toBe(true);
  });
});

describe('describeTarget', () => {
  it('describes a built-in site (lists commands)', () => {
    const result = describeTarget('test-describe');
    expect(result.type).toBe('builtin');
    expect(result.name).toBe('test-describe');
    expect(result.commands).toBeDefined();
    expect(result.commands!.length).toBe(2);
    expect(result.commands!.some(c => c.name === 'greet')).toBe(true);
    expect(result.commands!.some(c => c.name === 'farewell')).toBe(true);
  });

  it('describes a built-in command with full metadata', () => {
    const result = describeTarget('test-describe', ['greet']);
    expect(result.type).toBe('builtin');
    expect(result.name).toBe('test-describe/greet');
    expect(result.strategy).toBe('public');
    expect(result.browser).toBe(false);
    expect(result.domain).toBe('example.com');
    expect(result.args).toBeDefined();
    expect(result.args!.length).toBe(2);
    const nameArg = result.args!.find(a => a.name === 'name');
    expect(nameArg?.required).toBe(true);
    expect(nameArg?.positional).toBe(true);
    const langArg = result.args!.find(a => a.name === 'lang');
    expect(langArg?.choices).toEqual(['en', 'zh', 'ja']);
    expect(langArg?.default).toBe('en');
    expect(result.columns).toEqual(['message']);
  });

  it('throws CliError for unknown target', () => {
    expect(() => describeTarget('__nonexistent__')).toThrow('Unknown command');
  });

  it('throws CliError for unknown subcommand of known site', () => {
    expect(() => describeTarget('test-describe', ['__nonexistent__'])).toThrow('Unknown command');
  });

  it('describes an external CLI (gh)', () => {
    const result = describeTarget('gh');
    expect(result.type).toBe('external');
    expect(result.name).toBe('gh');
    if (result.installed) {
      expect(result.subcommands).toBeDefined();
      expect(result.help).toBeDefined();
      // Subcommand names should not have trailing colons
      if (result.subcommands!.length > 0) {
        expect(result.subcommands!.every(s => !s.name.endsWith(':'))).toBe(true);
      }
    }
  });

  it('describes external CLI with subcommand path', () => {
    const result = describeTarget('gh', ['pr']);
    expect(result.type).toBe('external');
    expect(result.name).toBe('gh pr');
    if (result.installed) {
      expect(result.subcommands).toBeDefined();
    }
  });
});
