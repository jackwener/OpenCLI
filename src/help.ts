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

export function formatRootAdapterHelpText(siteNames: readonly string[]): string {
  if (siteNames.length === 0) return '';
  return [
    '',
    `Site adapters (${siteNames.length}):`,
    wrapCommaList(siteNames),
    '',
    "Run 'opencli list' for full command details, or 'opencli <site> --help' to inspect one site.",
    "Agent tip: use 'opencli <site> --help -f yaml' for structured commands, args, access, and examples.",
    '',
  ].join('\n');
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
    ...(opts.includeColumns && cmd.columns?.length ? { columns: cmd.columns } : {}),
    ...(cmd.deprecated ? { deprecated: cmd.deprecated } : {}),
    ...(cmd.replacedBy ? { replacedBy: cmd.replacedBy } : {}),
  };
}

export function rootHelpData(program: Command, siteNames: readonly string[]): Record<string, unknown> {
  const siteSet = new Set(siteNames);
  const commands = program.commands
    .filter(command => !siteSet.has(command.name()))
    .map(command => ({
      name: command.name(),
      description: command.description(),
    }));

  return {
    name: program.name(),
    description: program.description(),
    commands,
    site_adapters: {
      count: siteNames.length,
      sites: [...siteNames].sort((a, b) => a.localeCompare(b)),
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
  const deprecatedSuffix = cmd.deprecated ? ' [deprecated]' : '';
  return `${access} ${cmd.description}${deprecatedSuffix}`;
}
