/** Validate CLI definitions from the registry (JS-first). */
import { getRegistry, fullName, type CliCommand, type InternalCliCommand } from './registry.js';
import { getRegisteredStepNames } from './pipeline/registry.js';

/**
 * Pipeline step names — derived from the live pipeline registry on each
 * validate call so a new step registered in src/pipeline/registry.ts (or by
 * a plugin at runtime) is automatically allowlisted here (no parallel
 * hand-maintained list, no stale-snapshot drift).
 */
function getKnownStepNames(): Set<string> {
  return new Set(getRegisteredStepNames());
}

export interface CommandValidationResult {
  /** Display label: "site/name" or source path if available */
  label: string;
  errors: string[];
  warnings: string[];
}

export interface ValidationReport {
  ok: boolean;
  results: CommandValidationResult[];
  errors: number;
  warnings: number;
  commands: number;
}

/**
 * Validate registered CLI commands from the in-memory registry.
 *
 * The `_dirs` parameter is kept for call-site compatibility but is no longer
 * used — validation now operates on the registry populated by `discoverClis()`.
 */
export function validateClisWithTarget(_dirs: string[], target?: string): ValidationReport {
  const registry = getRegistry();
  const results: CommandValidationResult[] = [];
  let errors = 0; let warnings = 0;

  if (registry.size === 0) {
    const r: CommandValidationResult = {
      label: '(registry)',
      errors: [],
      warnings: ['Registry is empty — no commands discovered. Did discoverClis() run?'],
    };
    return { ok: true, results: [r], errors: 0, warnings: 1, commands: 0 };
  }

  // Resolve alias target: if target is "site/alias", resolve to canonical "site/name"
  let resolvedTarget = target;
  if (target?.includes('/')) {
    const cmd = registry.get(target);
    if (cmd) resolvedTarget = fullName(cmd);
  }

  // Deduplicate: registry maps both canonical "site/name" and aliases to the same command
  const seen = new Set<CliCommand>();

  for (const [key, cmd] of registry) {
    if (seen.has(cmd)) continue;
    // Only validate via canonical key to avoid duplicates from aliases
    if (key !== fullName(cmd)) continue;
    seen.add(cmd);

    // Target filter: "site" or "site/name"
    if (resolvedTarget) {
      if (resolvedTarget.includes('/')) {
        if (key !== resolvedTarget) continue;
      } else {
        if (cmd.site !== resolvedTarget) continue;
      }
    }

    const r = validateCommand(cmd);
    results.push(r);
    errors += r.errors.length;
    warnings += r.warnings.length;
  }

  return { ok: errors === 0, results, errors, warnings, commands: results.length };
}

function validateCommand(cmd: CliCommand): CommandValidationResult {
  const label = fullName(cmd);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cmd.description) warnings.push('Missing description');

  // Browser commands should specify a domain for authenticated browser context
  if (cmd.browser && !cmd.domain) {
    warnings.push('Browser command without "domain" — authenticated browser context may not work');
  }

  // Pipeline validation: check step names for typos
  if (Array.isArray(cmd.pipeline)) {
    const knownStepNames = getKnownStepNames();
    for (let i = 0; i < cmd.pipeline.length; i++) {
      const step = cmd.pipeline[i];
      if (step && typeof step === 'object') {
        for (const key of Object.keys(step)) {
          if (!knownStepNames.has(key)) {
            warnings.push(
              `Pipeline step ${i}: unknown step name "${key}" (did you mean one of: ${[...knownStepNames].join(', ')}?)`
            );
          }
        }
      }
    }
  }

  // Commands should have either func, pipeline, or be a lazy-loaded module
  const internal = cmd as InternalCliCommand;
  if (!cmd.func && !cmd.pipeline && !internal._lazy) {
    errors.push('Command has neither "func" nor "pipeline" — it cannot execute');
  }

  // Arg validation
  if (cmd.args && cmd.args.length > 0) {
    const argNames = new Set<string>();
    let seenNonPositional = false;
    for (const arg of cmd.args) {
      if (argNames.has(arg.name)) {
        errors.push(`Duplicate arg name "${arg.name}"`);
      }
      argNames.add(arg.name);

      if (arg.positional && seenNonPositional) {
        warnings.push(`Positional arg "${arg.name}" appears after named args`);
      }
      if (!arg.positional) seenNonPositional = true;
    }
  }

  return { label, errors, warnings };
}

export function renderValidationReport(report: ValidationReport): string {
  const lines = [
    `opencli validate: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Checked ${report.commands} command(s)`,
    `Errors: ${report.errors}  Warnings: ${report.warnings}`,
  ];
  for (const r of report.results) {
    if (r.errors.length > 0 || r.warnings.length > 0) {
      lines.push(`\n${r.label}:`);
      for (const e of r.errors) lines.push(`  ❌ ${e}`);
      for (const w of r.warnings) lines.push(`  ⚠️  ${w}`);
    }
  }
  return lines.join('\n');
}
