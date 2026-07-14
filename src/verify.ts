/**
 * Verification: runs validation and an optional smoke test.
 *
 * The smoke test runs `vitest run tests/smoke/` from the package root when that
 * directory is present (repo/dev/CI checkouts). It reports "unavailable" when the
 * directory is absent — notably in published npm installs, since `tests/` is not
 * listed in package.json "files".
 */

import { validateClisWithTarget, renderValidationReport, type ValidationReport } from './validate.js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface VerifyOptions {
  builtinClis: string;
  userClis: string;
  target?: string;
  smoke?: boolean;
}

export interface VerifyReport {
  ok: boolean;
  validation: ValidationReport;
  smoke: null | {
    requested: boolean;
    executed: boolean;
    ok: boolean;
    summary: string;
  };
}

export async function verifyClis(opts: VerifyOptions): Promise<VerifyReport> {
  const report = validateClisWithTarget([opts.builtinClis, opts.userClis], opts.target);
  let smoke: VerifyReport['smoke'] = null;
  if (opts.smoke) {
    smoke = await runSmokeTests(opts.builtinClis);
  }
  return { ok: report.ok && (smoke?.ok ?? true), validation: report, smoke };
}

export function renderVerifyReport(report: VerifyReport): string {
  const base = renderValidationReport(report.validation);
  if (!report.smoke) return base;
  const status = report.smoke.ok ? 'PASS' : 'FAIL';
  const mode = report.smoke.executed ? 'executed' : 'skipped';
  return `${base}\nSmoke: ${status} (${mode}) — ${report.smoke.summary}`;
}

async function runSmokeTests(builtinClis: string): Promise<NonNullable<VerifyReport['smoke']>> {
  // builtinClis is `<packageRoot>/clis` (see src/main.ts: BUILTIN_CLIS =
  // path.join(findPackageRoot(__filename), 'clis')), so the package root that
  // owns tests/smoke is a single level up.
  const projectRoot = path.resolve(builtinClis, '..');
  const smokeDir = path.join(projectRoot, 'tests', 'smoke');

  if (!fs.existsSync(smokeDir)) {
    return {
      requested: true,
      executed: false,
      ok: false,
      summary: 'Smoke tests are unavailable in this package/environment.',
    };
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolve) => {
    const child = spawn(npx, ['vitest', 'run', 'tests/smoke/', '--reporter=dot'], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        requested: true,
        executed: false,
        ok: false,
        summary: `Failed to start smoke tests: ${error.message}`,
      });
    });

    child.on('close', (code) => {
      resolve({
        requested: true,
        executed: true,
        ok: code === 0,
        summary: code === 0 ? 'tests/smoke passed' : (stderr.trim() || `vitest exited with code ${code}`),
      });
    });
  });
}
