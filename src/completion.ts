/**
 * Shell tab-completion support for opencli.
 *
 * Provides:
 *  - Shell script generators for bash, zsh, and fish
 *  - Dynamic completion logic that returns candidates for the current cursor position
 */

import { pathToFileURL } from 'node:url';
import { getRegistry, splitCommandPath, type CliCommand, type InternalCliCommand } from './registry.js';
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
  'setup',
  'completion',
];

/**
 * Return completion candidates given the current command-line words and cursor index.
 *
 * @param words  - The argv after 'opencli' (words[0] is the first arg, e.g. site name)
 * @param cursor - 1-based position of the word being completed (1 = first arg)
 */
export async function getCompletions(words: string[], cursor: number): Promise<string[]> {
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

  const commandTokens = words.slice(1, Math.max(1, cursor - 1));
  const resolved = resolveCommandForArgs(site, commandTokens);
  if (resolved) {
    const loadedCmd = await ensureCompletionCommandLoaded(resolved.cmd);
    const optionArg = resolveActiveOptionArg(loadedCmd, commandTokens.slice(resolved.path.length));
    const currentToken = words[cursor - 1] ?? '';
    if (!optionArg) return [];

    try {
      const rawCandidates = optionArg.completion
        ? await optionArg.completion({
          words,
          cursor,
          site,
          command: loadedCmd.name,
          currentToken,
        })
        : optionArg.choices;
      if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) return [];
      return [...new Set(rawCandidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))].sort();
    } catch {
      return [];
    }
  }

  const prefix = words.slice(1, Math.max(1, cursor - 1));
  const candidates = new Set<string>();

  for (const [, cmd] of getRegistry()) {
    if (cmd.site !== site) continue;
    const paths = [cmd.name, ...(cmd.aliases ?? [])].map(splitCommandPath).filter(path => path.length > 0);
    for (const path of paths) {
      if (path.length < prefix.length + 1) continue;
      const matches = prefix.every((segment, index) => path[index] === segment);
      if (!matches) continue;
      candidates.add(path[prefix.length]);
    }
  }

  return [...candidates].sort();
}

function resolveCommandForArgs(site: string, tokensBeforeCurrent: string[]) {
  let best: { cmd: CliCommand; path: string[] } | null = null;
  const seen = new Set<string>();

  for (const [, cmd] of getRegistry()) {
    if (cmd.site !== site) continue;

    const canonicalKey = `${cmd.site}/${cmd.name}`;
    if (seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);

    const paths = [cmd.name, ...(cmd.aliases ?? [])].map(splitCommandPath).filter(path => path.length > 0);
    for (const path of paths) {
      if (tokensBeforeCurrent.length < path.length) continue;
      const matches = path.every((segment, index) => tokensBeforeCurrent[index] === segment);
      if (!matches) continue;
      if (!best || path.length > best.path.length) {
        best = { cmd, path };
      }
    }
  }

  return best;
}

function resolveActiveOptionArg(
  cmd: CliCommand,
  tokensAfterCommand: string[],
) {
  const previousToken = tokensAfterCommand[tokensAfterCommand.length - 1];
  if (!previousToken?.startsWith('--')) return null;

  const optionName = previousToken.slice(2);
  return cmd.args.find((arg) => !arg.positional && arg.name === optionName) ?? null;
}

async function ensureCompletionCommandLoaded(cmd: CliCommand): Promise<CliCommand> {
  const internal = cmd as InternalCliCommand;
  if (!internal._lazy || !internal._modulePath) return cmd;

  try {
    await import(pathToFileURL(internal._modulePath).href);
  } catch {
    return cmd;
  }

  return getRegistry().get(`${cmd.site}/${cmd.name}`) ?? cmd;
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
