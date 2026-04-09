/**
 * Shell tab-completion support for opencli.
 *
 * Provides:
 *  - Shell script generators for bash, zsh, and fish
 *  - Dynamic completion logic that returns candidates for the current cursor position
 */

import { getRegistry } from './registry.js';
import { CliError } from './errors.js';

// ── Dynamic completion logic ───────────────────────────────────────────────

/**
 * Built-in (non-dynamic) top-level commands.
 */
const BUILTIN_COMMANDS = [
  'list',
  'validate',
  'verify',
  'explore',
  'probe',        // alias for explore
  'synthesize',
  'generate',
  'cascade',
  'doctor',
  'plugin',
  'install',
  'register',
  'completion',
];

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

export function bashCompletionScript(): string {
  return `# Bash completion for opencli
# Add to ~/.bashrc:  eval "$(opencli completion bash)"
_opencli_completions() {
  local cur words cword
  _get_comp_words_by_ref -n : cur words cword

  local completions
  completions=$(opencli --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)

  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )
  __ltrim_colon_completions "$cur"
}
complete -F _opencli_completions opencli
`;
}

export function zshCompletionScript(): string {
  return `# Zsh completion for opencli
# Add to ~/.zshrc:  eval "$(opencli completion zsh)"
_opencli() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(opencli --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
compdef _opencli opencli
`;
}

export function fishCompletionScript(): string {
  return `# Fish completion for opencli
# Add to ~/.config/fish/config.fish:  opencli completion fish | source
complete -c opencli -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  opencli --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;
}

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
