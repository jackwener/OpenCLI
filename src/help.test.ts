import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { classifyAdapter, commanderCommandHelpData, formatRootAdapterHelpText } from './help.js';
import { createProgram } from './cli.js';

function findChild(parent: Command, name: string): Command {
  const child = parent.commands.find((c) => c.name() === name);
  if (!child) throw new Error(`No subcommand "${name}" under "${parent.name()}"`);
  return child;
}

function optionNames(spec: Record<string, unknown>): string[] {
  return (spec.command_options as Array<{ name: string }>).map((o) => o.name);
}

describe('classifyAdapter', () => {
  it('classifies DNS-style domains as site', () => {
    expect(classifyAdapter('www.bilibili.com')).toBe('site');
    expect(classifyAdapter('chatgpt.com')).toBe('site');
    expect(classifyAdapter('claude.ai')).toBe('site');
    expect(classifyAdapter('grok.com')).toBe('site');
  });

  it('classifies localhost as app (Electron / osascript desktop integrations)', () => {
    expect(classifyAdapter('localhost')).toBe('app');
  });

  it('classifies non-DNS domain strings as app (e.g. literal "doubao-app")', () => {
    expect(classifyAdapter('doubao-app')).toBe('app');
  });

  it('defaults missing domain to site (most adapters without explicit domain are public web scrapers)', () => {
    expect(classifyAdapter(undefined)).toBe('site');
  });
});

describe('formatRootAdapterHelpText', () => {
  it('renders all three sections in External / App / Site order when populated', () => {
    const text = formatRootAdapterHelpText({
      external: [
        { name: 'gh', label: 'gh' },
        { name: 'wx', label: 'wx(wx-cli)' },
      ],
      apps: ['chatwise', 'codex'],
      sites: ['bilibili'],
    });
    expect(text).toContain('External CLIs (2):');
    expect(text).toContain('App adapters (2):');
    expect(text).toContain('Site adapters (1):');
    expect(text).toContain('wx(wx-cli)');
    expect(text.indexOf('External CLIs')).toBeLessThan(text.indexOf('App adapters'));
    expect(text.indexOf('App adapters')).toBeLessThan(text.indexOf('Site adapters'));
  });

  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      external: [],
      apps: [],
      sites: ['bilibili'],
    });
    expect(text).not.toContain('External CLIs');
    expect(text).not.toContain('App adapters');
    expect(text).toContain('Site adapters (1):');
  });

  it('returns empty string when all groups are empty', () => {
    expect(formatRootAdapterHelpText({ external: [], apps: [], sites: [] })).toBe('');
  });

  it('always renders the agent discovery hint when any section is populated', () => {
    const text = formatRootAdapterHelpText({
      external: [],
      apps: [],
      sites: ['bilibili'],
    });
    expect(text).toContain("'opencli <site> --help -f yaml'");
  });
});

describe('commanderCommandHelpData namespace-option dedup (#1850)', () => {
  it('drops namespace-inherited options (--window/--session) from a browser leaf, keeps its own', () => {
    const program = createProgram('', '');
    const browser = findChild(program, 'browser');
    const leaf = findChild(browser, 'eval');

    // Sanity: --window IS declared on the leaf (so it parses in the trailing
    // position) and on the namespace root, so the dedup has something to remove.
    expect(leaf.options.some((o) => o.long === '--window')).toBe(true);
    expect(browser.options.some((o) => o.long === '--window')).toBe(true);

    const data = commanderCommandHelpData(browser, leaf, { globalCommand: program });
    const names = optionNames(data);

    // Namespace-inherited options must not be repeated in the leaf's own list.
    expect(names).not.toContain('window');
    expect(names).not.toContain('session');
    // The leaf's own option survives.
    expect(names).toContain('frame');
    // It is still surfaced once at the namespace level.
    const namespaceOptionNames = (data.namespace_options as Array<{ name: string }>).map((o) => o.name);
    expect(namespaceOptionNames).toContain('window');
  });

  it('leaves a non-browser namespace leaf unchanged (dedup only removes inherited opts)', () => {
    const program = createProgram('', '');
    const auth = findChild(program, 'auth');
    const leaf = findChild(auth, 'status');

    // The auth root declares no options of its own, so nothing is deduped: the
    // leaf's full own-option set is preserved (modulo hidden options, which the
    // help compactor always omits).
    const data = commanderCommandHelpData(auth, leaf, { globalCommand: program });
    const names = optionNames(data);
    const visibleOwnNames = leaf.options.filter((o) => !o.hidden).map((o) => o.attributeName());
    expect(names).toEqual(visibleOwnNames);
    expect(names).toContain('site');
    expect(names).toContain('format');
  });
});
