/**
 * Lightweight manifest-based completion for the fast path.
 *
 * This module MUST NOT import registry, discovery, or any heavy module.
 * It only reads pre-compiled cli-manifest.json files synchronously.
 */

import * as fs from 'node:fs';

const BUILTIN_COMMANDS = [
  'list',
  'validate',
  'verify',
  'explore',
  'probe',
  'synthesize',
  'generate',
  'cascade',
  'doctor',
  'plugin',
  'install',
  'register',
  'completion',
];

interface ManifestCompletionEntry {
  site: string;
  name: string;
  aliases?: string[];
}

/**
 * Returns true only if ALL manifest files exist and are readable.
 * If any source lacks a manifest (e.g. user adapters without a compiled manifest),
 * the fast path must not be used — otherwise those adapters would silently
 * disappear from completion results.
 */
export function hasAllManifests(manifestPaths: string[]): boolean {
  for (const p of manifestPaths) {
    try {
      fs.accessSync(p);
    } catch {
      return false;
    }
  }
  return manifestPaths.length > 0;
}

/**
 * Lightweight completion that reads directly from manifest JSON files,
 * bypassing full CLI discovery and adapter loading.
 */
export function getCompletionsFromManifest(words: string[], cursor: number, manifestPaths: string[]): string[] {
  const entries = loadManifestEntries(manifestPaths);
  if (entries === null) {
    return [];
  }

  if (cursor <= 1) {
    const sites = new Set<string>();
    for (const entry of entries) {
      sites.add(entry.site);
    }
    return [...BUILTIN_COMMANDS, ...sites].sort();
  }

  const site = words[0];
  if (BUILTIN_COMMANDS.includes(site)) {
    return [];
  }

  if (cursor === 2) {
    const subcommands: string[] = [];
    for (const entry of entries) {
      if (entry.site === site) {
        subcommands.push(entry.name);
        if (entry.aliases?.length) subcommands.push(...entry.aliases);
      }
    }
    return [...new Set(subcommands)].sort();
  }

  return [];
}

// ── Shell script generators (pure strings, no registry dependency) ───────

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

const SHELL_SCRIPTS: Record<string, () => string> = {
  bash: bashCompletionScript,
  zsh: zshCompletionScript,
  fish: fishCompletionScript,
};

/**
 * Print completion script for the given shell. Returns true if handled, false if unknown shell.
 */
export function printCompletionScriptFast(shell: string): boolean {
  const gen = SHELL_SCRIPTS[shell];
  if (!gen) return false;
  process.stdout.write(gen());
  return true;
}

function loadManifestEntries(manifestPaths: string[]): ManifestCompletionEntry[] | null {
  const entries: ManifestCompletionEntry[] = [];
  let found = false;
  for (const manifestPath of manifestPaths) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as ManifestCompletionEntry[];
      entries.push(...manifest);
      found = true;
    } catch { /* skip missing/unreadable */ }
  }
  return found ? entries : null;
}
