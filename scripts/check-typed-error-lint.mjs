#!/usr/bin/env node
/**
 * check-typed-error-lint.mjs — CI gate for newly introduced silent failures.
 *
 * Baseline mode keeps adoption small: existing findings are recorded in
 * scripts/typed-error-lint-baseline.json, while CI rejects any new
 * silent-clamp / silent-empty-fallback / silent-sentinel signatures.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DIST_AUDIT = resolve(PROJECT_ROOT, 'dist', 'src', 'convention-audit.js');
const BASELINE_PATH = resolve(__dirname, 'typed-error-lint-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const RULES = new Set(['silent-clamp', 'silent-empty-fallback', 'silent-sentinel']);

if (!existsSync(DIST_AUDIT)) {
  console.error('dist/src/convention-audit.js not found. Run npm run build before this check.');
  process.exit(1);
}

const { runConventionAudit } = await import(pathToFileURL(DIST_AUDIT).href);
const report = runConventionAudit({ projectRoot: PROJECT_ROOT });
const current = addOccurrenceIndexes(sortRecords(report.categories
  .filter((category) => RULES.has(category.rule))
  .flatMap((category) => category.violations.map(toBaselineRecord))));

if (UPDATE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${relative(BASELINE_PATH)} with ${current.length} typed-error lint baseline entr${current.length === 1 ? 'y' : 'ies'}.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`${relative(BASELINE_PATH)} not found. Run node scripts/check-typed-error-lint.mjs --update-baseline.`);
  process.exit(1);
}

const baseline = addOccurrenceIndexes(sortRecords(JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))));
const baselineSignatures = new Set(baseline.map(signature));
const currentSignatures = new Set(current.map(signature));
const added = current.filter((record) => !baselineSignatures.has(signature(record)));
const resolved = baseline.filter((record) => !currentSignatures.has(signature(record)));

console.log(`Typed-error lint gate: current=${current.length}, baseline=${baseline.length}, new=${added.length}, resolved=${resolved.length}`);

if (resolved.length > 0) {
  console.log('');
  console.log('Resolved baseline entries detected. Consider shrinking the baseline:');
  for (const record of resolved) {
    console.log(`  - ${record.rule} ${record.command} ${record.file}:${record.line}`);
  }
}

if (added.length === 0) {
  console.log('OK - no new typed-error lint violations.');
  process.exit(0);
}

console.log('');
console.log('New typed-error lint violations:');
for (const record of added) {
  console.log(`  - ${record.rule} ${record.command} ${record.file}:${record.line}`);
  if (record.text) console.log(`    ${record.text}`);
}
console.log('');
console.log('Fix the silent fallback, or if this is an intentional baseline adoption, run:');
console.log('  node scripts/check-typed-error-lint.mjs --update-baseline');
process.exit(1);

function toBaselineRecord(violation) {
  return {
    rule: String(violation.rule ?? ''),
    command: String(violation.command ?? ''),
    file: String(violation.file ?? ''),
    line: Number(violation.line ?? 0),
    text: String(violation.details?.text ?? ''),
  };
}

function signature(record) {
  return `${record.rule}\0${record.command}\0${record.file}\0${record.text}\0${record.occurrence}`;
}

function sortRecords(records) {
  return records
    .map((record) => ({
      rule: String(record.rule),
      command: String(record.command),
      file: String(record.file),
      line: Number(record.line ?? 0),
      text: String(record.text ?? ''),
      occurrence: Number(record.occurrence ?? 0),
    }))
    .sort((a, b) => stableOrder(a).localeCompare(stableOrder(b)));
}

function addOccurrenceIndexes(records) {
  const seen = new Map();
  return records.map((record) => {
    const key = `${record.rule}\0${record.command}\0${record.file}\0${record.text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...record, occurrence };
  });
}

function stableOrder(record) {
  return `${record.rule}\0${record.command}\0${record.file}\0${record.text}\0${record.line}`;
}

function relative(file) {
  return file.replace(`${PROJECT_ROOT}/`, '');
}
