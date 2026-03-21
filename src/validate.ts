/** Validate CLI definitions. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

/** All recognized pipeline step names */
const KNOWN_STEP_NAMES = new Set([
  'navigate', 'click', 'type', 'wait', 'press', 'snapshot', 'scroll',
  'fetch', 'evaluate',
  'select', 'map', 'filter', 'sort', 'limit',
  'intercept', 'tap',
]);

export interface FileValidationResult {
  path: string;
  errors: string[];
  warnings: string[];
}

export interface ValidationReport {
  ok: boolean;
  results: FileValidationResult[];
  errors: number;
  warnings: number;
  files: number;
}

interface ValidatedYamlCliDefinition {
  site?: string;
  name?: string;
  pipeline?: unknown[];
  columns?: unknown[];
  args?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateClisWithTarget(dirs: string[], target?: string): ValidationReport {
  const results: FileValidationResult[] = [];
  let errors = 0; let warnings = 0; let files = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const site of fs.readdirSync(dir)) {
      if (target && site !== target && !target.startsWith(site + '/')) continue;
      const siteDir = path.join(dir, site);
      if (!fs.statSync(siteDir).isDirectory()) continue;
      for (const file of fs.readdirSync(siteDir)) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        if (target && target.includes('/') && !target.endsWith(file.replace(/\.(yaml|yml)$/, ''))) continue;
        files++;
        const filePath = path.join(siteDir, file);
        const r = validateYamlFile(filePath);
        results.push(r);
        errors += r.errors.length;
        warnings += r.warnings.length;
      }
    }
  }
  return { ok: errors === 0, results, errors, warnings, files };
}

function validateYamlFile(filePath: string): FileValidationResult {
  const errors: string[] = []; const warnings: string[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as ValidatedYamlCliDefinition | null;
    if (!isRecord(def)) { errors.push('Not a valid YAML object'); return { path: filePath, errors, warnings }; }
    if (!def.site) errors.push('Missing "site"');
    if (!def.name) errors.push('Missing "name"');
    if (def.pipeline && !Array.isArray(def.pipeline)) errors.push('"pipeline" must be an array');
    if (def.columns && !Array.isArray(def.columns)) errors.push('"columns" must be an array');
    if (def.args && typeof def.args !== 'object') errors.push('"args" must be an object');
    // Validate pipeline step names (catch typos like 'navaigate')
    if (Array.isArray(def.pipeline)) {
      for (let i = 0; i < def.pipeline.length; i++) {
        const step = def.pipeline[i];
        if (step && typeof step === 'object') {
          const stepKeys = Object.keys(step);
          for (const key of stepKeys) {
            if (!KNOWN_STEP_NAMES.has(key)) {
              warnings.push(`Pipeline step ${i}: unknown step name "${key}" (did you mean one of: ${[...KNOWN_STEP_NAMES].join(', ')}?)`);
            }
          }
        }
      }
    }
  } catch (e) { errors.push(`YAML parse error: ${getErrorMessage(e)}`); }
  return { path: filePath, errors, warnings };
}

export function renderValidationReport(report: ValidationReport): string {
  const lines = [`opencli validate: ${report.ok ? 'PASS' : 'FAIL'}`, `Checked ${report.results.length} CLI(s) in ${report.files} file(s)`, `Errors: ${report.errors}  Warnings: ${report.warnings}`];
  for (const r of report.results) {
    if (r.errors.length > 0 || r.warnings.length > 0) {
      lines.push(`\n${r.path}:`);
      for (const e of r.errors) lines.push(`  ❌ ${e}`);
      for (const w of r.warnings) lines.push(`  ⚠️  ${w}`);
    }
  }
  return lines.join('\n');
}
