import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

function walkAdapterFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkAdapterFiles(fullPath);
    if (!entry.isFile()
      || !entry.name.endsWith('.ts')
      || entry.name.endsWith('.test.ts')
      || entry.name === 'test-utils.ts') return [];
    return [fullPath];
  });
}

describe('adapter imports', () => {
  it('keep runtime adapters limited to node builtins, relative modules, and opencli public APIs', () => {
    const clisDir = path.resolve(process.cwd(), 'clis');
    const offenders: Array<{ file: string; specifier: string }> = [];

    for (const filePath of walkAdapterFiles(clisDir)) {
      const source = fs.readFileSync(filePath, 'utf-8');
      const module = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

      for (const stmt of module.statements) {
        if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt)) continue;
        const specifier = stmt.moduleSpecifier?.getText(module).slice(1, -1);
        if (specifier && !isAllowedImport(specifier)) {
          offenders.push({
            file: path.relative(clisDir, filePath),
            specifier,
          });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
