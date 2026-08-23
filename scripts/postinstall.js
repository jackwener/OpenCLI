#!/usr/bin/env node

/**
 * postinstall script — install shell completion files and print setup instructions.
 *
 * Detects the user's default shell and writes the completion script to the
 * standard completion directory.  For zsh and bash, the script prints manual
 * instructions instead of modifying rc files (~/.zshrc, ~/.bashrc) — this
 * avoids breaking multi-line shell commands and other fragile rc structures.
 * Fish completions work automatically without rc changes.
 *
 * Supported shells: bash, zsh, fish.
 *
 * This script is intentionally plain Node.js (no TypeScript, no imports from
 * the main source tree) so that it can run without a build step.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));


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

async function installNativeHostManifestBestEffort() {
  const entry = join(SCRIPT_DIR, '..', 'dist', 'src', 'native-manifest.js');
  if (!existsSync(entry)) return;
  try {
    const { installNativeHostManifest } = await import(pathToFileURL(entry).href);
    const result = installNativeHostManifest();
    if (result?.files?.length) {
      console.log(`✓ Native Messaging host registered (${result.files.length} browser${result.files.length === 1 ? '' : 's'})`);
    }
  } catch (err) {
    if (process.env.OPENCLI_VERBOSE) {
      console.error(`Warning: Could not install native host: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  // Global installs and `npm link` only — a nested node_modules copy must
  // not overwrite the user's Chrome native-host registration.
  const isGlobal = process.env.npm_config_global === 'true';
  if (!isGlobal) {
    return;
  }

  await installNativeHostManifestBestEffort();

  const shell = detectShell();
  const home = homedir();

  if (!shell) {
    printBrowserBridgeHint();
    return;
  }

  try {
    switch (shell) {
      case 'zsh': {
        const completionsDir = join(home, '.zsh', 'completions');
        const completionFile = join(completionsDir, '_opencli');
        ensureDir(completionsDir);
        writeFileSync(completionFile, ZSH_COMPLETION, 'utf8');

        console.log(`✓ Zsh completion installed to ${completionFile}`);
        console.log('');
        console.log('  \x1b[1mTo enable, add these lines to your ~/.zshrc:\x1b[0m');
        console.log(`    fpath=(${completionsDir} $fpath)`);
        console.log('    autoload -Uz compinit && compinit');
        console.log('');
        console.log('  If you already have compinit (oh-my-zsh, zinit, etc.), just add the fpath line \x1b[1mbefore\x1b[0m it.');
        console.log('  Then restart your shell or run: \x1b[36mexec zsh\x1b[0m');
        break;
      }
      case 'bash': {
        const userCompDir = join(home, '.bash_completion.d');
        const completionFile = join(userCompDir, 'opencli');
        ensureDir(userCompDir);
        writeFileSync(completionFile, BASH_COMPLETION, 'utf8');

        console.log(`✓ Bash completion installed to ${completionFile}`);
        console.log('');
        console.log('  \x1b[1mTo enable, add this line to your ~/.bashrc:\x1b[0m');
        console.log(`    [ -f "${completionFile}" ] && source "${completionFile}"`);
        console.log('');
        console.log('  Then restart your shell or run: \x1b[36msource ~/.bashrc\x1b[0m');
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

  printBrowserBridgeHint();
}

function printBrowserBridgeHint() {
  console.log('');
  console.log('  \x1b[1mNext step — Browser Bridge\x1b[0m');
  console.log('  Browser commands need the Chrome extension (the native host is already registered):');
  console.log('  1. Download: https://github.com/jackwener/opencli/releases');
  console.log('  2. chrome://extensions → Developer Mode → Load unpacked');
  console.log('  3. Reload the extension if Chrome was already open');
  console.log('');
  console.log('  Then run \x1b[36mopencli doctor\x1b[0m to verify.');
  console.log('');
}

void main();
