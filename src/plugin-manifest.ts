/**
 * Plugin manifest: reads and validates opencli-plugin.json files.
 *
 * Supports two modes:
 * 1. Single plugin: repo root IS the plugin directory.
 * 2. Monorepo: repo contains multiple plugins declared in `plugins` field.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PKG_VERSION } from './version.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SubPluginEntry {
  /** Relative path from repo root to the sub-plugin directory. */
  path: string;
  version?: string;
  description?: string;
  /** Semver range for opencli compatibility (overrides top-level). */
  opencli?: string;
  /** When true, this sub-plugin is skipped during install. */
  disabled?: boolean;
}

export interface PluginManifest {
  /** Plugin name (single-plugin mode). */
  name?: string;
  /** Semantic version of the plugin (single-plugin mode). */
  version?: string;
  /** Semver range for opencli compatibility, e.g. ">=1.0.0". */
  opencli?: string;
  /** Human-readable description. */
  description?: string;
  /** Monorepo sub-plugins. Key = logical plugin name. */
  plugins?: Record<string, SubPluginEntry>;
}

export const MANIFEST_FILENAME = 'opencli-plugin.json';

// ── Read / Validate ─────────────────────────────────────────────────────────

/**
 * Read and parse opencli-plugin.json from a directory.
 * Returns null if the file does not exist or is unparseable.
 */
export function readPluginManifest(dir: string): PluginManifest | null {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PluginManifest;
  } catch {
    return null;
  }
}

/** Returns true when the manifest declares a monorepo (has `plugins` field). */
export function isMonorepo(manifest: PluginManifest): boolean {
  return (
    manifest.plugins !== undefined &&
    manifest.plugins !== null &&
    typeof manifest.plugins === 'object' &&
    Object.keys(manifest.plugins).length > 0
  );
}

/**
 * Get the list of enabled sub-plugins from a monorepo manifest.
 * Returns entries sorted by key name.
 */
export function getEnabledPlugins(
  manifest: PluginManifest,
): Array<{ name: string; entry: SubPluginEntry }> {
  if (!manifest.plugins) return [];
  return Object.entries(manifest.plugins)
    .filter(([, entry]) => !entry.disabled)
    .map(([name, entry]) => ({ name, entry }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Version compatibility ───────────────────────────────────────────────────

/**
 * Check if the current opencli version satisfies a semver range string.
 *
 * Supports a simplified subset of semver ranges:
 *   ">=1.0.0"   – greater than or equal
 *   "<=1.5.0"   – less than or equal
 *   ">1.0.0"    – strictly greater
 *   "<2.0.0"    – strictly less
 *   "^1.2.0"    – compatible (>=1.2.0 and <2.0.0)
 *   "~1.2.0"    – patch-level (>=1.2.0 and <1.3.0)
 *   "1.2.0"     – exact match
 *   ">=1.0.0 <2.0.0" – multiple constraints (space-separated, all must match)
 *
 * Returns true if compatible, false if not, and true for empty/undefined
 * ranges (no constraint = always compatible).
 */
export function checkCompatibility(range: string | undefined): boolean {
  if (!range || range.trim() === '') return true;
  return satisfiesRange(PKG_VERSION, range);
}

/** Parse a version string ("1.2.3") into [major, minor, patch]. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/** Compare two version tuples: -1 if a<b, 0 if equal, 1 if a>b. */
function compareVersions(
  a: [number, number, number],
  b: [number, number, number],
): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** Check if a version satisfies a single constraint like ">=1.2.0". */
function satisfiesSingleConstraint(
  version: [number, number, number],
  constraint: string,
): boolean {
  const trimmed = constraint.trim();
  if (!trimmed) return true;

  // ^1.2.0 → >=1.2.0 <2.0.0
  if (trimmed.startsWith('^')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return true;
    const upper: [number, number, number] = [target[0] + 1, 0, 0];
    return compareVersions(version, target) >= 0 && compareVersions(version, upper) < 0;
  }

  // ~1.2.0 → >=1.2.0 <1.3.0
  if (trimmed.startsWith('~')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return true;
    const upper: [number, number, number] = [target[0], target[1] + 1, 0];
    return compareVersions(version, target) >= 0 && compareVersions(version, upper) < 0;
  }

  // >=, <=, >, <, =
  if (trimmed.startsWith('>=')) {
    const target = parseVersion(trimmed.slice(2));
    if (!target) return true;
    return compareVersions(version, target) >= 0;
  }
  if (trimmed.startsWith('<=')) {
    const target = parseVersion(trimmed.slice(2));
    if (!target) return true;
    return compareVersions(version, target) <= 0;
  }
  if (trimmed.startsWith('>')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return true;
    return compareVersions(version, target) > 0;
  }
  if (trimmed.startsWith('<')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return true;
    return compareVersions(version, target) < 0;
  }
  if (trimmed.startsWith('=')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return true;
    return compareVersions(version, target) === 0;
  }

  // Exact match
  const target = parseVersion(trimmed);
  if (!target) return true;
  return compareVersions(version, target) === 0;
}

/**
 * Check if a version string satisfies a range expression.
 * Space-separated constraints are ANDed together.
 */
export function satisfiesRange(versionStr: string, range: string): boolean {
  const version = parseVersion(versionStr);
  if (!version) return true; // Can't parse our own version → assume ok

  // Split on whitespace for multi-constraint ranges (e.g. ">=1.0.0 <2.0.0")
  const constraints = range.trim().split(/\s+/);
  return constraints.every((c) => satisfiesSingleConstraint(version, c));
}

// ── Exports for testing ─────────────────────────────────────────────────────

export {
  readPluginManifest as _readPluginManifest,
  isMonorepo as _isMonorepo,
  getEnabledPlugins as _getEnabledPlugins,
  checkCompatibility as _checkCompatibility,
  parseVersion as _parseVersion,
  satisfiesRange as _satisfiesRange,
};
