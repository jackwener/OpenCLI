/**
 * Shared metadata and shell script generators for tab-completion.
 *
 * This module must stay lightweight: it is used by both the fast manifest path
 * and the full discovery path.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

interface CompletionTree {
  [key: string]: CompletionTree | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILTIN_COMMAND_TREE: CompletionTree = {
  list: null,
  validate: null,
  verify: null,
  browser: {
    tab: {
      list: null,
      new: null,
      select: null,
      close: null,
    },
    open: null,
    back: null,
    scroll: null,
    state: null,
    frames: null,
    screenshot: null,
    analyze: null,
    find: null,
    get: null,
    click: null,
    type: null,
    select: null,
    keys: null,
    wait: null,
    eval: null,
    extract: null,
    network: null,
    init: null,
    verify: null,
    close: null,
  },
  doctor: null,
  completion: {
    bash: null,
    zsh: null,
    fish: null,
  },
  plugin: {
    install: null,
    uninstall: null,
    update: null,
    list: null,
    create: null,
  },
  adapter: {
    status: null,
    eject: null,
    reset: null,
  },
  profile: {
    list: null,
    rename: null,
    use: null,
  },
  daemon: {
    status: null,
    stop: null,
  },
  external: {
    install: null,
    register: null,
    list: null,
  },
  install: null,
  register: null,
  antigravity: {
    serve: null,
    dump: null,
    'extract-code': null,
    model: null,
    new: null,
    read: null,
    send: null,
    status: null,
    watch: null,
  },
};

export const BUILTIN_COMMANDS = Object.keys(BUILTIN_COMMAND_TREE).sort();

interface ExternalCliConfig {
  name?: string;
}

function getBuiltinExternalCliPath(): string {
  return path.resolve(__dirname, 'external-clis.yaml');
}

function getUserExternalCliPath(): string {
  return path.join(os.homedir(), '.opencli', 'external-clis.yaml');
}

function loadExternalCliConfigNames(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = (yaml.load(raw) ?? []) as ExternalCliConfig[];
    return parsed
      .map(item => item?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}

export function loadExternalCliNames(): string[] {
  return [...new Set([
    ...loadExternalCliConfigNames(getBuiltinExternalCliPath()),
    ...loadExternalCliConfigNames(getUserExternalCliPath()),
  ])].sort();
}

export function getBuiltinCompletions(words: string[], cursor: number, externalCliNames: string[] = []): string[] | null {
  if (cursor <= 1) {
    return [...new Set([...BUILTIN_COMMANDS, ...externalCliNames])].sort();
  }

  const first = words[0];
  if (!first) return null;

  if (first === 'install' && cursor === 2) {
    return externalCliNames;
  }

  if (first === 'external' && words[1] === 'install' && cursor === 3) {
    return externalCliNames;
  }

  const root = BUILTIN_COMMAND_TREE[first];
  if (root === undefined) {
    return null;
  }

  return getTreeCompletions(root, words.slice(1), cursor - 1);
}

function getTreeCompletions(root: CompletionTree | null, words: string[], cursor: number): string[] {
  if (root === null) return [];
  if (cursor <= 1) return Object.keys(root).sort();

  let node: CompletionTree | null = root;
  for (let i = 0; i < cursor - 1; i++) {
    if (node === null) return [];
    const word = words[i];
    if (!word) return Object.keys(node).sort();
    const next: CompletionTree | null | undefined = node[word];
    if (next === undefined) return [];
    node = next;
  }

  return node === null ? [] : Object.keys(node).sort();
}

export function hasCliSourceFiles(clisDir: string): boolean {
  try {
    const sites = fs.readdirSync(clisDir, { withFileTypes: true });
    for (const site of sites) {
      if (!site.isDirectory()) continue;
      const siteDir = path.join(clisDir, site.name);
      const files = fs.readdirSync(siteDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        if (!file.name.endsWith('.js')) continue;
        if (file.name.endsWith('.d.js') || file.name.endsWith('.test.js') || file.name === 'index.js') continue;
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
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
