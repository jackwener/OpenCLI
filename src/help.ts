import { Command, type Argument as CommanderArgument, type Option as CommanderOption } from 'commander';
import yaml from 'js-yaml';
import type { Arg, CliCommand } from './registry.js';
import { fullName } from './registry.js';
import { formatCommandExample } from './serialization.js';

export type StructuredHelpFormat = 'yaml' | 'json';

export interface ArgSpec {
  name: string;
  required?: true;
  variadic?: true;
  help?: string;
  default?: unknown;
  choices?: string[];
}

export interface OptionSpec {
  name: string;
  flags: string;
  help?: string;
  takes_value?: 'required' | 'optional';
  required?: true;
  default?: unknown;
  choices?: string[];
  negate?: true;
}

const COMMON_OPTIONS = [
  {
    flags: '-f, --format <fmt>',
    name: 'format',
    help: 'Output format: table, plain, json, yaml, md, csv',
    default: 'table',
    choices: ['table', 'plain', 'json', 'yaml', 'md', 'csv'],
  },
  {
    flags: '--trace <mode>',
    name: 'trace',
    help: 'Trace capture: off, on, retain-on-failure',
    default: 'off',
    choices: ['off', 'on', 'retain-on-failure'],
  },
  {
    flags: '-v, --verbose',
    name: 'verbose',
    help: 'Debug output',
    default: false,
  },
  {
    flags: '-h, --help',
    name: 'help',
    help: 'display help for command',
  },
] as const;

const BROWSER_COMMON_OPTIONS = [
  {
    flags: '--window <mode>',
    name: 'window',
    help: 'Browser window mode: foreground or background',
    choices: ['foreground', 'background'],
  },
  {
    flags: '--site-session <mode>',
    name: 'site-session',
    help: 'Adapter site session lifecycle: ephemeral or persistent',
    choices: ['ephemeral', 'persistent'],
  },
  {
    flags: '--keep-tab <bool>',
    name: 'keep-tab',
    help: 'Keep the browser tab lease after the command finishes',
    choices: ['true', 'false'],
  },
] as const;

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
  lines.push("Agent tip: use 'opencli <site> --help -f yaml' for all command args/options in one structured response.");
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

function compactCommonOption(option: typeof COMMON_OPTIONS[number] | typeof BROWSER_COMMON_OPTIONS[number]): Record<string, unknown> {
  return {
    name: option.name,
    flags: option.flags,
    help: option.help,
    ...('default' in option ? { default: option.default } : {}),
    ...('choices' in option ? { choices: option.choices } : {}),
  };
}

function compactCommanderArgument(arg: CommanderArgument): ArgSpec {
  return {
    name: arg.name(),
    ...(arg.required ? { required: true } : {}),
    ...(arg.variadic ? { variadic: true } : {}),
    ...(arg.description ? { help: arg.description } : {}),
    ...(arg.defaultValue !== undefined ? { default: arg.defaultValue } : {}),
    ...(arg.argChoices?.length ? { choices: [...arg.argChoices] } : {}),
  };
}

function compactCommanderOption(option: CommanderOption): OptionSpec | null {
  if (option.hidden) return null;
  return {
    name: option.attributeName(),
    flags: option.flags,
    ...(option.description ? { help: option.description } : {}),
    ...(option.required ? { takes_value: 'required' as const } : {}),
    ...(option.optional ? { takes_value: 'optional' as const } : {}),
    ...(option.mandatory ? { required: true } : {}),
    ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}),
    ...(option.argChoices?.length ? { choices: [...option.argChoices] } : {}),
    ...(option.negate ? { negate: true } : {}),
  };
}

function compactCommanderOptions(options: readonly CommanderOption[]): OptionSpec[] {
  return options
    .map(compactCommanderOption)
    .filter((option): option is OptionSpec => option !== null);
}

function commanderPath(command: Command): string[] {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name) parts.push(name);
    current = current.parent;
  }
  return parts.reverse();
}

function commandPathFromRoot(namespaceRoot: Command, command: Command): string[] {
  const rootPath = commanderPath(namespaceRoot);
  const commandPath = commanderPath(command);
  return commandPath.slice(rootPath.length);
}

function collectLeafCommands(command: Command): Command[] {
  if (command.commands.length === 0) return [command];
  return command.commands.flatMap(child => collectLeafCommands(child));
}

function collectDescendantCommands(command: Command): Command[] {
  return command.commands.flatMap(child => [child, ...collectDescendantCommands(child)]);
}

function formatCommanderPositionals(args: readonly CommanderArgument[]): string {
  return args
    .map(arg => {
      const name = `${arg.name()}${arg.variadic ? '...' : ''}`;
      return arg.required ? `<${name}>` : `[${name}]`;
    })
    .join(' ');
}

function formatCommanderUsage(
  command: Command,
  opts: { namespaceRoot?: Command; globalCommand?: Command } = {},
): string {
  const path = commanderPath(command).join(' ');
  const positionalText = formatCommanderPositionals(command.registeredArguments);
  const hasOptions = compactCommanderOptions(command.options).length > 0
    || (opts.namespaceRoot ? compactCommanderOptions(opts.namespaceRoot.options).length > 0 : false)
    || (opts.globalCommand ? compactCommanderOptions(opts.globalCommand.options).length > 0 : false);
  const optionText = hasOptions ? ' [options]' : '';
  return `${path}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}

function compactCommanderCommand(
  namespaceRoot: Command,
  command: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  const relativePath = commandPathFromRoot(namespaceRoot, command);
  return {
    name: relativePath.join(' '),
    command: commanderPath(command).join(' '),
    usage: formatCommanderUsage(command, { namespaceRoot, globalCommand: opts.globalCommand }),
    description: command.description(),
    ...(command.aliases().length ? { aliases: command.aliases() } : {}),
    positionals: command.registeredArguments.map(compactCommanderArgument),
    command_options: compactCommanderOptions(command.options),
  };
}

export function commanderNamespaceHelpData(
  namespaceRoot: Command,
  opts: { globalCommand?: Command; description?: string } = {},
): Record<string, unknown> {
  const leaves = collectLeafCommands(namespaceRoot)
    .filter(command => command !== namespaceRoot)
    .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
  return {
    namespace: namespaceRoot.name(),
    command: commanderPath(namespaceRoot).join(' '),
    usage: `${commanderPath(namespaceRoot).join(' ')} <command> [args] [options]`,
    description: opts.description ?? namespaceRoot.description(),
    command_count: leaves.length,
    commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commanderPath(namespaceRoot).join(' ')} --help -f yaml`,
    },
  };
}

export function commanderCommandHelpData(
  namespaceRoot: Command,
  command: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  return {
    namespace: namespaceRoot.name(),
    ...compactCommanderCommand(namespaceRoot, command, opts),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commanderPath(command).join(' ')} --help -f yaml`,
    },
  };
}

export function commanderGroupHelpData(
  namespaceRoot: Command,
  groupCommand: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  const leaves = collectLeafCommands(groupCommand)
    .filter(command => command !== groupCommand)
    .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
  return {
    namespace: namespaceRoot.name(),
    group: commandPathFromRoot(namespaceRoot, groupCommand).join(' '),
    command: commanderPath(groupCommand).join(' '),
    usage: `${commanderPath(groupCommand).join(' ')} <command> [args] [options]`,
    description: groupCommand.description(),
    command_count: leaves.length,
    commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commanderPath(groupCommand).join(' ')} --help -f yaml`,
    },
  };
}

export function installCommanderNamespaceStructuredHelp(
  namespaceRoot: Command,
  opts: { globalCommand?: Command; description?: string } = {},
): void {
  installStructuredHelp(namespaceRoot, () => commanderNamespaceHelpData(namespaceRoot, opts));
  for (const command of collectDescendantCommands(namespaceRoot)) {
    if (command.commands.length > 0) {
      installStructuredHelp(command, () => commanderGroupHelpData(namespaceRoot, command, opts));
    } else {
      installStructuredHelp(command, () => commanderCommandHelpData(namespaceRoot, command, opts));
    }
  }
}

function positionals(cmd: CliCommand): Arg[] {
  return cmd.args.filter(arg => arg.positional);
}

function commandOptions(cmd: CliCommand): Arg[] {
  return cmd.args.filter(arg => !arg.positional);
}

function formatPositionals(args: readonly Arg[]): string {
  return args
    .map(arg => arg.required ? `<${arg.name}>` : `[${arg.name}]`)
    .join(' ');
}

function formatCommandOptionTerm(arg: Arg): string {
  if (arg.required || arg.valueRequired) return `--${arg.name} <value>`;
  return `--${arg.name} [value]`;
}

export function formatCommandListTerm(cmd: CliCommand): string {
  const positionalText = formatPositionals(positionals(cmd));
  const optionText = commandOptions(cmd).length > 0 ? ' [options]' : '';
  return `${cmd.name}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}

function formatUsage(cmd: CliCommand): string {
  const positionalText = formatPositionals(positionals(cmd));
  return `opencli ${cmd.site} ${cmd.name}${positionalText ? ` ${positionalText}` : ''} [options]`;
}

function compactCommand(cmd: CliCommand): Record<string, unknown> {
  return {
    name: cmd.name,
    command: `opencli ${cmd.site} ${cmd.name}`,
    usage: formatUsage(cmd),
    access: cmd.access,
    description: cmd.description,
    browser: !!cmd.browser,
    ...(cmd.domain ? { domain: cmd.domain } : {}),
    ...(cmd.aliases?.length ? { aliases: cmd.aliases } : {}),
    positionals: positionals(cmd).map(compactArg),
    command_options: commandOptions(cmd).map(compactArg),
    ...(cmd.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
    example: formatCommandExample(cmd),
    ...(cmd.siteSession ? { siteSession: cmd.siteSession } : {}),
    ...(cmd.defaultFormat ? { defaultFormat: cmd.defaultFormat } : {}),
    ...(cmd.columns?.length ? { columns: cmd.columns } : {}),
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
    common_options: COMMON_OPTIONS.map(compactCommonOption),
    ...(unique.some(cmd => cmd.browser) ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
    next: [
      `opencli ${site} <command> --help -f yaml`,
      `opencli ${site} <command> -f yaml`,
    ],
  };
}

export function commandHelpData(cmd: CliCommand): Record<string, unknown> {
  return {
    site: cmd.site,
    ...compactCommand(cmd),
    common_options: COMMON_OPTIONS.map(compactCommonOption),
    ...(cmd.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
    output_formats: ['table', 'plain', 'yaml', 'json', 'md', 'csv'],
  };
}

function formatRows(rows: readonly [string, string][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.min(Math.max(...rows.map(([left]) => left.length)), 34);
  return rows.map(([left, right]) => `  ${left.padEnd(width + 2)}${right}`);
}

function formatArgHelp(arg: Arg): string {
  const parts: string[] = [];
  if (arg.help) parts.push(arg.help);
  if (arg.default !== undefined) parts.push(`default: ${arg.default}`);
  if (arg.choices?.length) parts.push(`choices: ${arg.choices.join(', ')}`);
  return parts.join('  ');
}

export function formatCommonOptionsHelpText(): string {
  const rows = COMMON_OPTIONS.map(option => {
    const details: string[] = [option.help];
    if ('default' in option) details.push(`default: ${option.default}`);
    if ('choices' in option) details.push(`choices: ${option.choices.join(', ')}`);
    return [option.flags, details.join('  ')] as [string, string];
  });
  return ['Common options:', ...formatRows(rows)].join('\n');
}

export function formatBrowserCommonOptionsHelpText(): string {
  const rows = BROWSER_COMMON_OPTIONS.map(option => {
    const details: string[] = [option.help];
    if ('choices' in option) details.push(`choices: ${option.choices.join(', ')}`);
    return [option.flags, details.join('  ')] as [string, string];
  });
  return ['Browser common options:', ...formatRows(rows)].join('\n');
}

export function formatSiteHelpText(site: string, commands: readonly CliCommand[]): string {
  const unique = [...new Map(commands.map(cmd => [fullName(cmd), cmd])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [
    `Usage: opencli ${site} <command> [args] [options]`,
    '',
    wrapCommaList(unique.map(cmd => cmd.name), { indent: '' }),
    '',
    'Commands:',
    ...formatRows(unique.map(cmd => [formatCommandListTerm(cmd), formatSiteCommandDescription(cmd)])),
    '',
    formatCommonOptionsHelpText(),
    ...(unique.some(cmd => cmd.browser) ? ['', formatBrowserCommonOptionsHelpText()] : []),
    '',
    `Agent tip: use 'opencli ${site} --help -f yaml' to get all command args/options in one structured response.`,
    '',
  ];
  return lines.join('\n');
}

export function formatCommandHelpText(cmd: CliCommand): string {
  const lines: string[] = [
    `Usage: ${formatUsage(cmd)}`,
    '',
    cmd.description,
    '',
  ];

  const positionalRows = positionals(cmd).map(arg => [
    arg.name,
    formatArgHelp(arg),
  ] as [string, string]);
  if (positionalRows.length) {
    lines.push('Arguments:', ...formatRows(positionalRows), '');
  }

  const optionRows = commandOptions(cmd).map(arg => [
    formatCommandOptionTerm(arg),
    formatArgHelp(arg),
  ] as [string, string]);
  if (optionRows.length) {
    lines.push('Command options:', ...formatRows(optionRows), '');
  }

  lines.push(formatCommonOptionsHelpText(), '');
  if (cmd.browser) lines.push(formatBrowserCommonOptionsHelpText(), '');

  const meta: string[] = [];
  meta.push(`Access: ${cmd.access}`);
  meta.push(`Browser: ${cmd.browser ? 'yes' : 'no'}`);
  if (cmd.domain) meta.push(`Domain: ${cmd.domain}`);
  if (cmd.defaultFormat) meta.push(`Default format: ${cmd.defaultFormat}`);
  if (cmd.aliases?.length) meta.push(`Aliases: ${cmd.aliases.join(', ')}`);
  lines.push(meta.join(' | '));
  lines.push(`Example: ${formatCommandExample(cmd)}`);
  if (cmd.columns?.length) lines.push(`Output columns: ${cmd.columns.join(', ')}`);
  lines.push("Agent tip: use '--help -f yaml' for structured args/options.");
  lines.push('');
  return lines.join('\n');
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
