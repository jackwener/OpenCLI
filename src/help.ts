import { Command } from 'commander';
import yaml from 'js-yaml';
import type { Arg, CliCommand } from './registry.js';
import { fullName } from './registry.js';
import { formatCommandExample } from './serialization.js';

export type StructuredHelpFormat = 'yaml' | 'json';

function normalizeStructuredHelpFormat(value: string | undefined): StructuredHelpFormat | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === 'yaml' || normalized === 'yml') return 'yaml';
  if (normalized === 'json') return 'json';
  return undefined;
}

export function getRequestedHelpFormat(argv: readonly string[] = process.argv): StructuredHelpFormat | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-f' || token === '--format') {
      return normalizeStructuredHelpFormat(argv[i + 1]);
    }
    if (token.startsWith('--format=')) {
      return normalizeStructuredHelpFormat(token.slice('--format='.length));
    }
    if (token.startsWith('-f') && token.length > 2) {
      return normalizeStructuredHelpFormat(token.slice(2));
    }
  }
  return undefined;
}

export function renderStructuredHelp(data: unknown, format: StructuredHelpFormat): string {
  if (format === 'json') return `${JSON.stringify(data, null, 2)}\n`;
  return yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true });
}

export function wrapCommaList(
  items: readonly string[],
  opts: { width?: number; indent?: string } = {},
): string {
  const width = Math.max(opts.width ?? process.stdout.columns ?? 100, 40);
  const indent = opts.indent ?? '  ';
  const sorted = [...items].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  let line = indent;

  sorted.forEach((item, index) => {
    const token = `${item}${index < sorted.length - 1 ? ',' : ''}`;
    const prefix = line === indent ? '' : ' ';
    if (line.length + prefix.length + token.length > width && line.trim()) {
      lines.push(line);
      line = `${indent}${token}`;
    } else {
      line += `${prefix}${token}`;
    }
  });
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

/**
 * Adapter category for help-text grouping.
 *
 * - `site`: web site adapter (real DNS-style domain, e.g. `www.bilibili.com`)
 * - `app`: desktop app adapter (Electron/osascript, signaled by `domain: 'localhost'`
 *   or other non-DNS string like `'doubao-app'`)
 *
 * Classification is derived from the adapter's `domain` field — no new schema
 * required. Adapters without a `domain` field default to `site` (most are
 * public web scrapers).
 */
export type AdapterKind = 'site' | 'app';

export function classifyAdapter(domain: string | undefined): AdapterKind {
  if (!domain) return 'site';
  return domain.includes('.') ? 'site' : 'app';
}

export interface RootAdapterGroups {
  /** Externally-registered CLIs (docker, gh, vercel, ...) — passthrough binaries */
  external: readonly string[];
  /** Desktop-app adapters (chatgpt-app, chatwise, codex, ...) */
  apps: readonly string[];
  /** Web-site adapters (bilibili, dianping, ...) */
  sites: readonly string[];
}

function formatGroupSection(label: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  return [
    `${label} (${names.length}):`,
    wrapCommaList(names),
    '',
  ];
}

export function formatRootAdapterHelpText(groups: RootAdapterGroups): string {
  const total = groups.external.length + groups.apps.length + groups.sites.length;
  if (total === 0) return '';
  const lines: string[] = [''];
  lines.push(...formatGroupSection('External CLIs', groups.external));
  lines.push(...formatGroupSection('App adapters', groups.apps));
  lines.push(...formatGroupSection('Site adapters', groups.sites));
  lines.push("Run 'opencli list' for full command details, or 'opencli <site> --help' to inspect one site.");
  lines.push("Agent tip: use 'opencli <site> --help -f yaml' for structured commands, args, access, and examples.");
  lines.push('');
  return lines.join('\n');
}

function compactArg(arg: Arg): Record<string, unknown> {
  return {
    name: arg.name,
    ...(arg.type && arg.type !== 'string' ? { type: arg.type } : {}),
    ...(arg.positional ? { positional: true } : {}),
    ...(arg.required ? { required: true } : {}),
    ...(arg.valueRequired ? { valueRequired: true } : {}),
    ...(arg.default !== undefined ? { default: arg.default } : {}),
    ...(arg.choices?.length ? { choices: arg.choices } : {}),
    ...(arg.help ? { help: arg.help } : {}),
  };
}

function compactCommand(cmd: CliCommand, opts: { includeColumns?: boolean } = {}): Record<string, unknown> {
  return {
    name: cmd.name,
    command: `opencli ${cmd.site} ${cmd.name}`,
    access: cmd.access,
    description: cmd.description,
    ...(cmd.aliases?.length ? { aliases: cmd.aliases } : {}),
    args: cmd.args.map(compactArg),
    example: formatCommandExample(cmd),
    ...(cmd.browserSession ? { browserSession: cmd.browserSession } : {}),
    ...(cmd.defaultFormat ? { defaultFormat: cmd.defaultFormat } : {}),
    ...(opts.includeColumns && cmd.columns?.length ? { columns: cmd.columns } : {}),
  };
}

export function rootHelpData(program: Command, groups: RootAdapterGroups): Record<string, unknown> {
  const adapterNames = new Set<string>([...groups.external, ...groups.apps, ...groups.sites]);
  const commands = program.commands
    .filter(command => !adapterNames.has(command.name()))
    .map(command => ({
      name: command.name(),
      description: command.description(),
    }));

  const sortLocale = (a: string, b: string) => a.localeCompare(b);
  return {
    name: program.name(),
    description: program.description(),
    commands,
    external_clis: {
      count: groups.external.length,
      clis: [...groups.external].sort(sortLocale),
    },
    app_adapters: {
      count: groups.apps.length,
      apps: [...groups.apps].sort(sortLocale),
    },
    site_adapters: {
      count: groups.sites.length,
      sites: [...groups.sites].sort(sortLocale),
    },
    next: [
      'opencli <site> --help -f yaml',
      'opencli list -f yaml',
      'opencli <site> <command> -f yaml',
    ],
  };
}

export function siteHelpData(site: string, commands: readonly CliCommand[]): Record<string, unknown> {
  const unique = [...new Map(commands.map(cmd => [fullName(cmd), cmd])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    site,
    command_count: unique.length,
    commands: unique.map(cmd => compactCommand(cmd)),
    next: [
      `opencli ${site} <command> --help -f yaml`,
      `opencli ${site} <command> -f yaml`,
    ],
  };
}

export function commandHelpData(cmd: CliCommand): Record<string, unknown> {
  return {
    site: cmd.site,
    ...compactCommand(cmd, { includeColumns: true }),
    output_formats: ['table', 'plain', 'yaml', 'json', 'md', 'csv'],
  };
}

export function installStructuredHelp(
  command: Command,
  data: () => unknown,
  textSuffix?: string | (() => string),
): void {
  const original = command.helpInformation.bind(command);
  command.helpInformation = ((contextOptions?: unknown) => {
    const format = getRequestedHelpFormat();
    if (format) return renderStructuredHelp(data(), format);
    const suffix = typeof textSuffix === 'function' ? textSuffix() : textSuffix ?? '';
    return original(contextOptions as never) + suffix;
  }) as Command['helpInformation'];
}

export function formatSiteCommandDescription(cmd: CliCommand): string {
  const access = cmd.access === 'write' ? '[write]' : '[read]';
  return `${access} ${cmd.description}`;
}
