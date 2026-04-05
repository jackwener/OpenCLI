/**
 * Regression tests for package exports.
 *
 * Ensures adapter files use @jackwener/opencli/... package imports
 * (not fragile relative paths) and that all declared exports resolve
 * to real files. Prevents regressions like #788 / #791.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLIS_DIR = path.join(ROOT, 'clis');

/** Recursively collect all .ts files in a directory. */
function collectTsFiles(dir: string, opts?: { excludeTests?: boolean }): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full, opts));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      if (opts?.excludeTests && (entry.name.endsWith('.test.ts') || entry.name === 'test-utils.ts')) continue;
      results.push(full);
    }
  }
  return results;
}

const ALLOWED_BARE_IMPORTS = new Set([
  '@jackwener/opencli',
  ...builtinModules.flatMap((name) => name.startsWith('node:')
    ? [name, name.slice(5)]
    : [name, `node:${name}`]),
]);

function isAllowedImport(specifier: string): boolean {
  return specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('/')
    || specifier.startsWith('@jackwener/opencli/')
    || ALLOWED_BARE_IMPORTS.has(specifier);
}

/** Forbidden relative import patterns that should have been replaced.
 * Uses (?:\.\./)+ to catch any depth of ../ traversal.
 * Covers: import/export from, vi.mock(), vi.importActual(). */
const FORBIDDEN_PATTERNS = [
  /(?:from|mock|importActual)\s*\(?['"](?:\.\.\/)+src\//,
  /(?:from|mock|importActual)\s*\(?['"](?:\.\.\/)+browser\//,
  /(?:from|mock|importActual)\s*\(?['"](?:\.\.\/)+download\//,
  /(?:from|mock|importActual)\s*\(?['"](?:\.\.\/)+pipeline\//,
];

describe('adapter imports use package exports', () => {
  const adapterFiles = collectTsFiles(CLIS_DIR);
  const runtimeAdapterFiles = collectTsFiles(CLIS_DIR, { excludeTests: true });

  it('found adapter files to check', () => {
    expect(adapterFiles.length).toBeGreaterThan(100);
  });

  it('no adapter uses relative imports to src/, browser/, download/, or pipeline/', () => {
    const violations: string[] = [];
    for (const file of adapterFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          const rel = path.relative(ROOT, file);
          const match = content.match(pattern)?.[0];
          violations.push(`${rel}: ${match}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('non-test adapters only import node builtins, relative modules, or opencli public APIs', () => {
    const violations: Array<{ file: string; specifier: string }> = [];

    for (const file of runtimeAdapterFiles) {
      const source = fs.readFileSync(file, 'utf-8');
      const module = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

      for (const stmt of module.statements) {
        if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt)) continue;
        const specifier = stmt.moduleSpecifier?.getText(module).slice(1, -1);
        if (specifier && !isAllowedImport(specifier)) {
          violations.push({
            file: path.relative(ROOT, file),
            specifier,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('package.json exports resolve to real files', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const exports = pkgJson.exports as Record<string, string>;

  it('has exports defined', () => {
    expect(Object.keys(exports).length).toBeGreaterThan(5);
  });

  for (const [exportPath, target] of Object.entries(exports)) {
    it(`export "${exportPath}" → ${target} has a source file`, () => {
      // Export targets point to dist/ (compiled). Verify the source .ts exists.
      // dist/src/foo.js → src/foo.ts
      const sourcePath = target
        .replace(/^\.\/dist\//, './')
        .replace(/\.js$/, '.ts');
      const fullPath = path.join(ROOT, sourcePath);
      expect(fs.existsSync(fullPath), `Missing source: ${sourcePath}`).toBe(true);
    });
  }
});
