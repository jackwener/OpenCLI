import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../errors.js';
import { installCommanderNamespaceStructuredHelp } from '../help.js';
import { findPackageRoot, getBuiltEntryCandidates } from '../package-paths.js';
import { getRegistry } from '../registry.js';


import { emitFailure, emitResult } from '../command-output.js';
const CLI_FILE = fileURLToPath(import.meta.url);
const STATIC_IMPORT_SPECIFIER_RE = /^\s*(?:import\s+(?:[^;]*?\s+from\s*)?|export\s+(?:\*(?:\s+as\s+[\w$]+)?|{[^;]*?})\s+from\s*)['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_SPECIFIER_RE = /(?:^|[^\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function listJsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [STATIC_IMPORT_SPECIFIER_RE, DYNAMIC_IMPORT_SPECIFIER_RE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveImportTarget(importerPath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importerPath), specifier);
  const candidates = path.extname(base) ? [base] : [base, `${base}.js`, path.join(base, 'index.js')];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? base;
}

function collectRepoSharedDependencies(entryDir: string, sharedDir: string): string[] {
  const pending = listJsFiles(entryDir);
  const seenFiles = new Set<string>();
  const sharedDeps = new Set<string>();

  for (let index = 0;index < pending.length;index += 1) {
    const filePath = pending[index];
    if (seenFiles.has(filePath)) continue;
    seenFiles.add(filePath);

    const source = fs.readFileSync(filePath, 'utf-8');
    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = resolveImportTarget(filePath, specifier);
      if (!resolved || !isPathInside(resolved, sharedDir)) continue;
      sharedDeps.add(resolved);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) pending.push(resolved);
      else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) pending.push(...listJsFiles(resolved));
    }
  }

  return [...sharedDeps].sort();
}

function copyEjectedRepoSharedDependencies(builtinSiteDir: string, builtinSharedDir: string, userClisDir: string): void {
  const sharedDeps = collectRepoSharedDependencies(builtinSiteDir, builtinSharedDir);
  for (const source of sharedDeps) {
    const relative = path.relative(builtinSharedDir, source);
    const target = path.join(userClisDir, '_shared', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

/** Coerce adapter JSON output into a row array. Accepts `[{...}]`, single `{}`, or `{items:[...]}`-style envelopes. */
export function normalizeVerifyRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? r as Record<string, unknown> : { value: r }));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const k of ['rows', 'items', 'data', 'results']) {
      if (Array.isArray(obj[k])) {
        return (obj[k] as unknown[]).map((r) => (r && typeof r === 'object' ? r as Record<string, unknown> : { value: r }));
      }
    }
    return [obj];
  }
  return [];
}

export function registerAdapterCommands(program: Command, BUILTIN_CLIS: string, USER_CLIS: string): Command {
  // ── Built-in: adapter management ─────────────────────────────────────────
  const adapterCmd = program.command('adapter').description('Manage CLI adapters');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalAdapterDescription = adapterCmd.description();

  adapterCmd
    .command('status')
    .description('Show which sites have local overrides vs using official baseline')
    .action(async () => {
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');
      const builtinClisDir = BUILTIN_CLIS;
      try {
        const userEntries = await fs.promises.readdir(userClisDir, { withFileTypes: true });
        const userSites = userEntries.filter(e => e.isDirectory()).map(e => e.name).sort();
        let builtinSites: string[] = [];
        try {
          const builtinEntries = await fs.promises.readdir(builtinClisDir, { withFileTypes: true });
          builtinSites = builtinEntries.filter(e => e.isDirectory()).map(e => e.name).sort();
        } catch { /* no builtin dir */ }

        emitResult({ overrides: userSites.map(site => ({ site, kind: builtinSites.includes(site) ? 'override' : 'custom' })), builtinSites: builtinSites.length });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') emitResult({ overrides: [] });
        else emitFailure(error);
      }
    });

  adapterCmd
    .command('eject')
    .description('Copy an official adapter to ~/.opencli/clis/ for local editing')
    .argument('<site>', 'Site name (e.g. twitter, bilibili)')
    .action(async (site: string) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(site)) { emitFailure({ code: 'usage_error', message: 'Invalid site name.' }); return; }
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');
      const builtinSiteDir = path.join(BUILTIN_CLIS, site);
      const builtinSharedDir = path.join(BUILTIN_CLIS, '_shared');
      const userSiteDir = path.join(userClisDir, site);

      try {
        await fs.promises.access(builtinSiteDir);
      } catch {
        emitFailure(`Error: Site "${site}" not found in official adapters.`, EXIT_CODES.USAGE_ERROR);
        return;
      }

      try {
        await fs.promises.access(userSiteDir);
        emitFailure(`Site "${site}" already exists in ~/.opencli/clis/. Use "opencli adapter reset ${site}" first to restore official version.`, EXIT_CODES.USAGE_ERROR);
        return;
      } catch { /* good, doesn't exist yet */ }

      fs.cpSync(builtinSiteDir, userSiteDir, { recursive: true });
      copyEjectedRepoSharedDependencies(builtinSiteDir, builtinSharedDir, userClisDir);
      emitResult({ site, directory: userSiteDir });
    });

  adapterCmd
    .command('reset')
    .description('Remove local override and restore official adapter version')
    .argument('[site]', 'Site name (e.g. twitter, bilibili)')
    .option('--all', 'Reset all local overrides')
    .action(async (site: string | undefined, opts: { all?: boolean }) => {
      if ((site && !/^[a-zA-Z0-9_-]+$/.test(site)) || (site && opts.all)) { emitFailure({ code: 'usage_error', message: 'Use a site name or --all.' }); return; }
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');

      if (opts.all) {
        try {
          const userEntries = await fs.promises.readdir(userClisDir, { withFileTypes: true });
          const dirs = userEntries.filter(e => e.isDirectory());
          if (dirs.length === 0) {
            emitResult({ reset: [] });
            return;
          }
          for (const dir of dirs) {
            fs.rmSync(path.join(userClisDir, dir.name), { recursive: true, force: true });
          }
          emitResult({ reset: dirs.map(dir => dir.name) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') emitResult({ reset: [] });
          else emitFailure(error);
        }
        return;
      }

      if (!site) {
        emitFailure('Error: Please specify a site name or use --all.', EXIT_CODES.USAGE_ERROR);
        return;
      }

      const userSiteDir = path.join(userClisDir, site);
      try {
        await fs.promises.access(userSiteDir);
      } catch {
        emitFailure(`Site "${site}" has no local override.`);
        return;
      }

      const isOfficial = fs.existsSync(path.join(BUILTIN_CLIS, site));
      fs.rmSync(userSiteDir, { recursive: true, force: true });
      emitResult({ site, reset: true, official: isOfficial });
    });

  // ── Init (adapter scaffolding) ──

  adapterCmd.command('init')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Generate adapter scaffold in ~/.opencli/clis/')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          emitFailure('Name must be site/command format (e.g. hn/top)', EXIT_CODES.USAGE_ERROR);
          return;
        }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          emitFailure('Name parts must be alphanumeric/dash/underscore only', EXIT_CODES.USAGE_ERROR);
          return;
        }

        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.join(os.homedir(), '.opencli', 'clis', site);
        const filePath = path.join(dir, `${command}.js`);

        if (fs.existsSync(filePath)) {
          emitResult({ file: filePath, created: false });
          return;
        }

        const domain = site;

        const template = `import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${site}',
  name: '${command}',
  description: '', // TODO: describe what this command does
  access: 'read',  // TODO: 'read' for queries, 'write' for remote/account state changes
  example: 'opencli ${site} ${command}',
  domain: '${domain}',
  strategy: Strategy.PUBLIC, // TODO: PUBLIC (no auth), COOKIE (needs login), UI (DOM interaction)
  browser: false,            // TODO: set true if needs browser
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: [], // TODO: field names for table output (e.g. ['title', 'score', 'url'])
  func: async (kwargs) => {
    // TODO: implement data fetching
    // Prefer API calls (fetch) over browser automation
    // If you set browser: true, change this to: async (page, kwargs) => { ... }
    return [];
  },
});
`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, template, 'utf-8');
        emitResult({ file: filePath, created: true });
      } catch (err) {
        emitFailure(`Error: ${err instanceof Error ? err.message : String(err)}`, EXIT_CODES.GENERIC_ERROR);
      }
    });

  // ── Verify (test adapter) ──

  adapterCmd.command('check').argument('[target]', 'site or site/command')
    .description('Check adapter definitions without executing them')
    .action(async target => {
      const { validateClisWithTarget } = await import('../validate.js');
      const report = validateClisWithTarget(target);
      if (!report.ok) { emitFailure({ code: 'validation_failed', message: `${report.errors} definition errors`, details: report }); return; }
      emitResult(report);
    });

  adapterCmd.command('test').argument('[name]', 'site/command (required unless --smoke)')
    .description('Execute an adapter and compare its result with an optional fixture; real writes may occur')
    .option('--args <json>', 'Argument object or CLI argument array; overrides fixture args')
    .option('--write-fixture', 'Create a fixture from this result if none exists')
    .option('--update-fixture', 'Replace the fixture using this result')
    .option('--no-fixture', 'Skip fixture assertions')
    .option('--smoke', 'Run the repository smoke suite')
    .option('--trace <mode>', 'Trace capture: off, on, retain-on-failure', 'off')
    .option('--profile <name>', 'Chrome profile/context')
    .action(async (name, opts, command) => {
      try {
        if (opts.smoke) {
          const { verifyClis } = await import('../verify.js');
          const report = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target: name, smoke: true });
          if (!report.ok) { emitFailure({ code: 'test_failed', message: 'Smoke suite or definition check failed.', details: report }); return; }
          emitResult(report); return;
        }
        if (!name || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(name)) throw Object.assign(new Error('Specify site/command or --smoke.'), { code: 'usage_error' });
        const [site, commandName] = name.split('/');
        const registered = getRegistry().get(name);
        const userFile = path.join(USER_CLIS || path.join(os.homedir(), '.opencli', 'clis'), site, `${commandName}.js`);
        if (!registered && !fs.existsSync(userFile)) throw new Error(`Adapter not found: ${name}`);
        const { execFileSync } = await import('node:child_process');
        const { loadFixture, writeFixture, deriveFixture, validateRows, fixturePath, expandFixtureArgs, parseSeedArgs } = await import('../browser/verify-fixture.js');
        let fixture = opts.fixture === false ? null : loadFixture(site, commandName);
        const explicitArgs = opts.args === undefined ? fixture?.args : parseSeedArgs(opts.args);
        const cliArgs = expandFixtureArgs(explicitArgs);
        const invocation = resolveBrowserVerifyInvocation();
        const profile = command.optsWithGlobals().profile;
        const args = [...invocation.args, ...(profile ? ['--profile', profile] : []), site, commandName,
        ...cliArgs, '--format', 'json', ...(opts.trace !== 'off' ? ['--trace', opts.trace] : [])];
        let result: any;
        try {
          result = JSON.parse(execFileSync(invocation.binary, args, {
            cwd: invocation.cwd, timeout: 30_000, encoding: 'utf-8', env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'], ...(invocation.shell ? { shell: true } : {}),
          }));
        } catch (error) {
          const failure = error as { stdout?: string; signal?: string };
          if (failure.stdout) {
            try { const envelope = JSON.parse(String(failure.stdout)); if (envelope.ok === false) { emitFailure(envelope); return; } } catch { /* malformed child output */ }
          }
          throw Object.assign(new Error('Adapter execution failed; inspect trace or rerun the command.'), {
            code: failure.signal || error instanceof SyntaxError || registered?.access === 'write' ? 'outcome_unknown' : 'adapter_test_failed',
          });
        }
        if (result.ok !== true) throw new Error('Adapter output is not a success envelope.');
        const rows = normalizeVerifyRows(result.data);
        if ((opts.writeFixture && !fixture) || opts.updateFixture) {
          fixture = deriveFixture(rows, explicitArgs);
          writeFixture(site, commandName, fixture);
        }
        const failures = fixture ? validateRows(rows, fixture) : [];
        if (failures.length) { emitFailure({ code: 'fixture_mismatch', message: 'Adapter result does not match fixture.', details: failures }); return; }
        emitResult({ name, rows: rows.length, fixture: fixture ? fixturePath(site, commandName) : null, result: result.data });
      } catch (error) { emitFailure(error); }
    });

  installCommanderNamespaceStructuredHelp(adapterCmd, { globalCommand: program, description: originalAdapterDescription });
  return adapterCmd;
}
export interface BrowserVerifyInvocation {
  binary: string;
  args: string[];
  cwd: string;
  shell?: boolean;
}

export { findPackageRoot };

export function resolveBrowserVerifyInvocation(opts: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
} = {}): BrowserVerifyInvocation {
  const platform = opts.platform ?? process.platform;
  const fileExists = opts.fileExists ?? fs.existsSync;
  const readFile = opts.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));
  const projectRoot = opts.projectRoot ?? findPackageRoot(CLI_FILE, fileExists);

  for (const builtEntry of getBuiltEntryCandidates(projectRoot, readFile)) {
    if (fileExists(builtEntry)) {
      return {
        binary: process.execPath,
        args: [builtEntry],
        cwd: projectRoot,
      };
    }
  }

  const sourceEntry = path.join(projectRoot, 'src', 'main.ts');
  if (!fileExists(sourceEntry)) {
    throw new Error(`Could not find opencli entrypoint under ${projectRoot}. Expected built entry from package.json or src/main.ts.`);
  }

  const localTsxBin = path.join(projectRoot, 'node_modules', '.bin', platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (fileExists(localTsxBin)) {
    return {
      binary: localTsxBin,
      args: [sourceEntry],
      cwd: projectRoot,
      ...(platform === 'win32' ? { shell: true } : {}),
    };
  }

  return {
    binary: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['tsx', sourceEntry],
    cwd: projectRoot,
    ...(platform === 'win32' ? { shell: true } : {}),
  };
}
