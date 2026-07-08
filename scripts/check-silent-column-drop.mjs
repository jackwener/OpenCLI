#!/usr/bin/env node
/**
 * check-silent-column-drop.mjs — CI gate for newly introduced table-output loss.
 *
 * This gate intentionally uses a baseline. The repo currently has known
 * silent-column-drop findings, and blocking every existing violation would make
 * the first CI adoption PR too large. The invariant enforced here is:
 *
 *   no new silent-column-drop signatures beyond scripts/silent-column-drop-baseline.json
 *
 * When a follow-up sweep fixes existing violations, run:
 *
 *   node scripts/check-silent-column-drop.mjs --update-baseline
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DIST_AUDIT = resolve(PROJECT_ROOT, 'dist', 'src', 'convention-audit.js');
const BASELINE_PATH = resolve(__dirname, 'silent-column-drop-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

if (!existsSync(DIST_AUDIT)) {
  console.error('dist/src/convention-audit.js not found. Run npm run build before this check.');
  process.exit(1);
}

const { runConventionAudit } = await import(pathToFileURL(DIST_AUDIT).href);
const report = runConventionAudit({ projectRoot: PROJECT_ROOT });
const category = report.categories.find((item) => item.rule === 'silent-column-drop');
const current = sortRecords((category?.violations ?? []).map(toBaselineRecord));

if (UPDATE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${relative(BASELINE_PATH)} with ${current.length} silent-column-drop baseline entr${current.length === 1 ? 'y' : 'ies'}.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`${relative(BASELINE_PATH)} not found. Run node scripts/check-silent-column-drop.mjs --update-baseline.`);
  process.exit(1);
}

const baseline = sortRecords(JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')));
const baselineSignatures = new Set(baseline.map(signature));
const currentSignatures = new Set(current.map(signature));
const added = current.filter((record) => !baselineSignatures.has(signature(record)));
const resolved = baseline.filter((record) => !currentSignatures.has(signature(record)));

console.log(`Silent-column-drop gate: current=${current.length}, baseline=${baseline.length}, new=${added.length}, resolved=${resolved.length}`);

if (resolved.length > 0) {
  console.log('');
  console.log('Resolved baseline entries detected. Consider shrinking the baseline:');
  for (const record of resolved) {
    console.log(`  - ${record.command} ${record.file} missing=[${record.missing.join(', ')}]`);
  }
}

if (added.length === 0) {
  console.log('OK - no new silent-column-drop violations.');
  process.exit(0);
}

console.log('');
console.log('New silent-column-drop violations:');
for (const record of added) {
  console.log(`  - ${record.command} ${record.file} missing=[${record.missing.join(', ')}]`);
}
console.log('');
console.log('Fix the adapter columns, or if this is an intentional baseline adoption, run:');
console.log('  node scripts/check-silent-column-drop.mjs --update-baseline');
process.exit(1);

function toBaselineRecord(violation) {
  const missing = Array.isArray(violation.details?.missing)
    ? violation.details.missing.map(String).sort()
    : [];
  return {
    command: String(violation.command ?? ''),
    file: String(violation.file ?? ''),
    missing,
  };
}

function signature(record) {
  return `${record.command}\0${record.file}\0${record.missing.join('\0')}`;
}

function sortRecords(records) {
  return records
    .map((record) => ({
      command: String(record.command),
      file: String(record.file),
      missing: Array.isArray(record.missing) ? record.missing.map(String).sort() : [],
    }))
    .sort((a, b) => signature(a).localeCompare(signature(b)));
}

function relative(file) {
  return file.replace(`${PROJECT_ROOT}/`, '');
}
