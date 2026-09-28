import { ArgumentError, ReadOnlyPolicyError } from './errors.js';
import { fullName, type CliCommand } from './registry.js';

const READ_ONLY_ENV = 'OPENCLI_READ_ONLY';

function parseReadOnlyEnv(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === '') return false;

  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
      return true;
    case '0':
    case 'false':
      return false;
    default:
      throw new ArgumentError(`${READ_ONLY_ENV} must be one of: 1, 0, true, false. Received: "${raw}"`);
  }
}

/**
 * Enforce the opt-in adapter read-only policy before command preparation or
 * lifecycle work can run. Direct browser primitives and external CLI
 * passthroughs do not carry adapter access metadata and are outside this gate.
 */
export function enforceAdapterReadOnlyPolicy(
  cmd: CliCommand,
  explicitReadOnly: boolean = false,
  envValue: string | undefined = process.env.OPENCLI_READ_ONLY,
): void {
  if (!explicitReadOnly && !parseReadOnlyEnv(envValue)) return;
  if (cmd.access === 'read') return;
  throw new ReadOnlyPolicyError(fullName(cmd));
}
