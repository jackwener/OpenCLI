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
 * Ensure fpath contains the custom completions directory in .zshrc.
 *
 * Key detail: the fpath line MUST appear BEFORE the first `compinit` call,
 * otherwise compinit won't scan our completions directory.  This is critical
 * for oh-my-zsh users (source $ZSH/oh-my-zsh.sh calls compinit internally).
 */
function ensureZshFpath(completionsDir, zshrcPath) {
  const fpathLine = `fpath=(${completionsDir} $fpath)`;
  const autoloadLine = `autoload -Uz compinit && compinit`;
  const marker = '# opencli completion';

  if (!existsSync(zshrcPath)) {
    writeFileSync(zshrcPath, `${marker}\n${fpathLine}\n${autoloadLine}\n`, 'utf8');
    return;
  }

  const content = readFileSync(zshrcPath, 'utf8');

  // Already configured — nothing to do
  if (content.includes(completionsDir)) {
    return;
  }

  // Find the first line that triggers compinit (direct call or oh-my-zsh source)
  const lines = content.split('\n');
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip comment-only lines
    if (trimmed.startsWith('#')) continue;
    if (/compinit/.test(trimmed) || /source\s+.*oh-my-zsh\.sh/.test(trimmed)) {
      insertIdx = i;
      break;
    }
  }

  if (insertIdx !== -1) {
    // Insert fpath BEFORE the compinit / oh-my-zsh source line
    lines.splice(insertIdx, 0, marker, fpathLine);
    writeFileSync(zshrcPath, lines.join('\n'), 'utf8');
  } else {
    // No compinit found — append fpath + compinit at the end
    let addition = `\n${marker}\n${fpathLine}\n${autoloadLine}\n`;
    appendFileSync(zshrcPath, addition, 'utf8');
  }
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

  // ── Spotify credentials template ────────────────────────────────────
  const opencliDir = join(home, '.opencli');
  const spotifyEnvFile = join(opencliDir, 'spotify.env');
  ensureDir(opencliDir);
  if (!existsSync(spotifyEnvFile)) {
    writeFileSync(spotifyEnvFile,
      `# Spotify credentials — get them at https://developer.spotify.com/dashboard\n` +
      `# Add http://127.0.0.1:8888/callback as a Redirect URI in your Spotify app\n` +
      `SPOTIFY_CLIENT_ID=your_spotify_client_id_here\n` +
      `SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here\n`,
      'utf8'
    );
    console.log(`✓ Spotify credentials template created at ${spotifyEnvFile}`);
    console.log(`  Edit the file and add your Client ID and Secret, then run: opencli spotify auth`);
  }

  // ── Browser Bridge setup hint ───────────────────────────────────────
  console.log('');
  console.log('  \x1b[1mNext step — Browser Bridge setup\x1b[0m');
  console.log('  Browser commands (bilibili, zhihu, twitter...) require the extension:');
  console.log('  1. Download: https://github.com/jackwener/opencli/releases');
  console.log('  2. In Chrome or Chromium, open chrome://extensions → enable Developer Mode → Load unpacked');
  console.log('');
  console.log('  Then run \x1b[36mopencli doctor\x1b[0m to verify.');
  console.log('');
}

main();
