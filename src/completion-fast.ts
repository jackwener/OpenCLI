/**
 * Lightweight manifest-based completion for the fast path.
 *
 * This module MUST NOT import registry, discovery, or any heavy module.
 * It only reads pre-compiled cli-manifest.json files synchronously.
 */

import * as fs from 'node:fs';
import {
  getBuiltinCompletions,
  bashCompletionScript,
  zshCompletionScript,
  fishCompletionScript,
  loadExternalCliNames,
} from './completion-shared.js';

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
export function getCompletionsFromManifest(words: string[], cursor: number, manifestPaths: string[]): string[] | null {
  const entries = loadManifestEntries(manifestPaths);
  if (entries === null) {
    return null;
  }

  const externalCliNames = loadExternalCliNames();
  const builtinCompletions = getBuiltinCompletions(words, cursor, externalCliNames);
  if (builtinCompletions !== null) {
    if (cursor <= 1) {
      const sites = new Set<string>();
      for (const entry of entries) {
        sites.add(entry.site);
      }
      return [...new Set([...builtinCompletions, ...sites])].sort();
    }
    return builtinCompletions;
  }

  const site = words[0];

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

// ── Shell script generators (re-exported from shared, no registry dependency) ───────

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
  for (const manifestPath of manifestPaths) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as ManifestCompletionEntry[];
      entries.push(...manifest);
    } catch {
      return null;
    }
  }
  return entries;
}
