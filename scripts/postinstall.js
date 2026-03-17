#!/usr/bin/env node

/**
 * postinstall script — automatically install shell completion files.
 *
 * Detects the user's default shell and writes the completion script to the
 * standard system completion directory so that tab-completion works immediately
 * after `npm install -g`.
 *
 * Supported shells: bash, zsh, fish.
 *
 * This script is intentionally plain Node.js (no TypeScript, no imports from
 * the main source tree) so that it can run without a build step.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';


// ── Completion script content ──────────────────────────────────────────────

const BASH_COMPLETION = `# Bash completion for opencli (auto-installed)
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

const ZSH_COMPLETION = `#compdef opencli
# Zsh completion for opencli (auto-installed)
_opencli() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(opencli --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
_opencli
`;

const FISH_COMPLETION = `# Fish completion for opencli (auto-installed)
complete -c opencli -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  opencli --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;

// ── Helpers ────────────────────────────────────────────────────────────────

function detectShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('fish')) return 'fish';
  return null;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure fpath contains the custom completions directory in .zshrc
 */
function ensureZshFpath(completionsDir, zshrcPath) {
  const fpathLine = `fpath=(${completionsDir} $fpath)`;
  const autoloadLine = `autoload -Uz compinit && compinit`;

  if (!existsSync(zshrcPath)) {
    writeFileSync(zshrcPath, `${fpathLine}\n${autoloadLine}\n`, 'utf8');
    return;
  }

  const content = readFileSync(zshrcPath, 'utf8');

  // Check if completions dir is already in fpath
  if (content.includes(completionsDir)) {
    return; // already configured
  }

  // Append fpath configuration
  let addition = `\n# opencli completion\n${fpathLine}\n`;
  if (!content.includes('compinit')) {
    addition += `${autoloadLine}\n`;
  }
  appendFileSync(zshrcPath, addition, 'utf8');
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  // Only install completion for global installs and npm link
  const isGlobal = process.env.npm_config_global === 'true';
  if (!isGlobal) {
    return;
  }

  const shell = detectShell();
  if (!shell) {
    // Cannot determine shell; silently skip
    return;
  }

  const home = homedir();

  try {
    switch (shell) {
      case 'zsh': {
        const completionsDir = join(home, '.zsh', 'completions');
        const completionFile = join(completionsDir, '_opencli');
        ensureDir(completionsDir);
        writeFileSync(completionFile, ZSH_COMPLETION, 'utf8');

        // Ensure fpath is set up in .zshrc
        const zshrcPath = join(home, '.zshrc');
        ensureZshFpath(completionsDir, zshrcPath);

        console.log(`✓ Zsh completion installed to ${completionFile}`);
        console.log(`  Restart your shell or run: source ~/.zshrc`);
        break;
      }
      case 'bash': {
        // Try system-level first, fall back to user-level
        const userCompDir = join(home, '.bash_completion.d');
        const completionFile = join(userCompDir, 'opencli');
        ensureDir(userCompDir);
        writeFileSync(completionFile, BASH_COMPLETION, 'utf8');

        // Ensure .bashrc sources the completion directory
        const bashrcPath = join(home, '.bashrc');
        if (existsSync(bashrcPath)) {
          const content = readFileSync(bashrcPath, 'utf8');
          if (!content.includes('.bash_completion.d/opencli')) {
            appendFileSync(bashrcPath,
              `\n# opencli completion\n[ -f "${completionFile}" ] && source "${completionFile}"\n`,
              'utf8'
            );
          }
        }

        console.log(`✓ Bash completion installed to ${completionFile}`);
        console.log(`  Restart your shell or run: source ~/.bashrc`);
        break;
      }
      case 'fish': {
        const completionsDir = join(home, '.config', 'fish', 'completions');
        const completionFile = join(completionsDir, 'opencli.fish');
        ensureDir(completionsDir);
        writeFileSync(completionFile, FISH_COMPLETION, 'utf8');

        console.log(`✓ Fish completion installed to ${completionFile}`);
        console.log(`  Restart your shell to activate.`);
        break;
      }
    }
  } catch (err) {
    // Completion install is best-effort; never fail the package install
    if (process.env.OPENCLI_VERBOSE) {
      console.error(`Warning: Could not install shell completion: ${err.message}`);
    }
  }
}

main();
