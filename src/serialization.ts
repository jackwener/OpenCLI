/**
 * Serialization and formatting helpers for CLI commands and args.
 *
 * Used by the `list` command, Commander --help, and build-manifest.
 * Separated from registry.ts to keep the registry focused on types + registration.
 */

import type { Arg, CliCommand } from './registry.js';
import { fullName, strategyLabel } from './registry.js';

// ── Serialization ───────────────────────────────────────────────────────────

export type SerializedArg = {
  name: string;
  type: string;
  required: boolean;
  valueRequired: boolean;
  positional: boolean;
  choices: string[];
  default: unknown;
  help: string;
};

/** Stable arg schema — every field is always present (no sparse objects). */
export function serializeArg(a: Arg): SerializedArg {
  return {
    name: a.name,
    type: a.type ?? 'string',
    required: !!a.required,
    valueRequired: !!a.valueRequired,
    positional: !!a.positional,
    choices: a.choices ?? [],
    default: a.default ?? null,
    help: a.help ?? '',
  };
}

/** Full command metadata for structured output (json/yaml). */
export function serializeCommand(cmd: CliCommand) {
  return {
    command: fullName(cmd),
    site: cmd.site,
    name: cmd.name,
    aliases: cmd.aliases ?? [],
    description: cmd.description,
    strategy: strategyLabel(cmd),
    browser: !!cmd.browser,
    args: cmd.args.map(serializeArg),
    columns: cmd.columns ?? [],
    domain: cmd.domain ?? null,
    deprecated: cmd.deprecated ?? null,
    replacedBy: cmd.replacedBy ?? null,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Human-readable arg summary: `<required> [optional]` style. */
export function formatArgSummary(args: Arg[]): string {
  return args
    .map(a => {
      if (a.positional) return a.required ? `<${a.name}>` : `[${a.name}]`;
      return a.required ? `--${a.name}` : `[--${a.name}]`;
    })
    .join(' ');
}

function summarizeChoices(choices: string[]): string {
  if (choices.length <= 4) return choices.join(', ');
  return `${choices.slice(0, 4).join(', ')}, ... (+${choices.length - 4} more)`;
}

/** Generate the --help appendix showing registry metadata not exposed by Commander. */
export function formatRegistryHelpText(cmd: CliCommand): string {
  const lines: string[] = [];
  const choicesArgs = cmd.args.filter(a => a.choices?.length);
  for (const a of choicesArgs) {
    const prefix = a.positional ? `<${a.name}>` : `--${a.name}`;
    const def = a.default != null ? `  (default: ${a.default})` : '';
    lines.push(`  ${prefix}: ${summarizeChoices(a.choices!)}${def}`);
  }
  const meta: string[] = [];
  meta.push(`Strategy: ${strategyLabel(cmd)}`);
  meta.push(`Browser: ${cmd.browser ? 'yes' : 'no'}`);
  if (cmd.domain) meta.push(`Domain: ${cmd.domain}`);
  if (cmd.deprecated) meta.push(`Deprecated: ${typeof cmd.deprecated === 'string' ? cmd.deprecated : 'yes'}`);
  if (cmd.replacedBy) meta.push(`Use instead: ${cmd.replacedBy}`);
  if (cmd.aliases?.length) meta.push(`Aliases: ${cmd.aliases.join(', ')}`);
  lines.push(meta.join(' | '));
  if (cmd.columns?.length) lines.push(`Output columns: ${cmd.columns.join(', ')}`);
  return '\n' + lines.join('\n') + '\n';
}
