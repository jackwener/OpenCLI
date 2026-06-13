import { ArgumentError, AuthRequiredError, CommandExecutionError, ConfigError } from '@jackwener/opencli/errors';
import { SLOCK_DOMAIN } from './shared.js';

// EvaluateResult is the envelope every in-page snippet returns. Kinds:
//   { kind: 'ok', rows, meta? }
//   { kind: 'auth', detail }
//   { kind: 'http', status, where }
//   { kind: 'no-server', detail }
//   { kind: 'unresolvable', detail }
//   { kind: 'no-thread', parent }       // handled by caller, never reaches dispatcher
export function dispatchEvaluateResult(r) {
  switch (r && r.kind) {
    case 'ok':
      return r.rows;
    case 'auth':
      throw new AuthRequiredError(SLOCK_DOMAIN, r.detail);
    case 'http':
      throw new CommandExecutionError(`HTTP ${r.status} from ${r.where}`);
    case 'no-server':
      throw new ConfigError(r.detail, 'Run `opencli slock server-use <slug>` to set the active server.');
    case 'unresolvable':
      throw new ArgumentError(r.detail);
    case 'no-thread':
      // caller decides what to do (returns a 0-row hint); should never reach here
      throw new CommandExecutionError(`no-thread should be handled by caller, not dispatcher: ${r.parent}`);
    default:
      // unknown / null envelope = contract drift; fail loud (reddit precedent)
      throw new CommandExecutionError(`unexpected evaluate envelope: ${JSON.stringify(r)}`);
  }
}
