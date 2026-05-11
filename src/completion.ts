/**
 * Shell tab-completion support for opencli.
 *
 * Provides:
 *  - Shell script generators for bash, zsh, and fish
 *  - Dynamic completion logic that returns candidates for the current cursor position
 */

import { getRegistry } from './registry.js';
import { CliError } from './errors.js';
import {
  BUILTIN_COMMANDS,
  bashCompletionScript,
  zshCompletionScript,
  fishCompletionScript,
} from './completion-shared.js';

// Re-export shell scripts so existing callers (cli.ts) don't break
export { bashCompletionScript, zshCompletionScript, fishCompletionScript };

// ── Dynamic completion logic ───────────────────────────────────────────────

/**
 * Return completion candidates given the current command-line words and cursor index.
 * Requires full CLI discovery to have been run (uses getRegistry()).
 *
 * @param words  - The argv after 'opencli' (words[0] is the first arg, e.g. site name)
 * @param cursor - 1-based position of the word being completed (1 = first arg)
 */
export function getCompletions(words: string[], cursor: number): string[] {
  // cursor === 1 → completing the first argument (site name or built-in command)
  if (cursor <= 1) {
    const sites = new Set<string>();
    for (const [, cmd] of getRegistry()) {
      sites.add(cmd.site);
    }
    return [...BUILTIN_COMMANDS, ...sites].sort();
  }

  const site = words[0];

  // If the first word is a built-in command, no further completion
  if (BUILTIN_COMMANDS.includes(site)) {
    return [];
  }

  // cursor === 2 → completing the sub-command name under a site
  if (cursor === 2) {
    const subcommands: string[] = [];
    for (const [, cmd] of getRegistry()) {
      if (cmd.site === site) {
        subcommands.push(cmd.name);
        if (cmd.aliases?.length) subcommands.push(...cmd.aliases);
      }
    }
    return [...new Set(subcommands)].sort();
  }

  // cursor >= 3 → no further completion
  return [];
}

// ── Shell script generators ────────────────────────────────────────────────

/**
 * Print the completion script for the requested shell.
 */
export function printCompletionScript(shell: string): void {
  switch (shell) {
    case 'bash':
      process.stdout.write(bashCompletionScript());
      break;
    case 'zsh':
      process.stdout.write(zshCompletionScript());
      break;
    case 'fish':
      process.stdout.write(fishCompletionScript());
      break;
    default:
      throw new CliError('UNSUPPORTED_SHELL', `Unsupported shell: ${shell}. Supported: bash, zsh, fish`);
  }
}
