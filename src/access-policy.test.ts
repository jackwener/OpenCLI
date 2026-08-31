import { describe, expect, it } from 'vitest';
import { enforceAdapterReadOnlyPolicy } from './access-policy.js';
import { ArgumentError, EXIT_CODES, ReadOnlyPolicyError, toEnvelope } from './errors.js';
import type { CliCommand } from './registry.js';

function command(access: 'read' | 'write'): CliCommand {
  return {
    site: 'test-policy',
    name: access,
    access,
    description: `${access} policy fixture`,
    browser: false,
    args: [],
    func: async () => [],
  };
}

describe('adapter read-only policy', () => {
  it('keeps default adapter execution unchanged', () => {
    expect(() => enforceAdapterReadOnlyPolicy(command('write'), false, undefined)).not.toThrow();
    expect(() => enforceAdapterReadOnlyPolicy(command('write'), false, '0')).not.toThrow();
    expect(() => enforceAdapterReadOnlyPolicy(command('write'), false, 'false')).not.toThrow();
  });

  it('allows commands declared access: read', () => {
    expect(() => enforceAdapterReadOnlyPolicy(command('read'), true, undefined)).not.toThrow();
    expect(() => enforceAdapterReadOnlyPolicy(command('read'), false, '1')).not.toThrow();
    expect(() => enforceAdapterReadOnlyPolicy(command('read'), false, 'TRUE')).not.toThrow();
  });

  it('returns a typed permission error for commands declared access: write', () => {
    const error = (() => {
      try {
        enforceAdapterReadOnlyPolicy(command('write'), true, undefined);
      } catch (err) {
        return err;
      }
    })();

    expect(error).toBeInstanceOf(ReadOnlyPolicyError);
    expect(error).toMatchObject({ code: 'READ_ONLY_POLICY', exitCode: EXIT_CODES.NOPERM });
    expect(toEnvelope(error)).toMatchObject({
      ok: false,
      error: {
        code: 'READ_ONLY_POLICY',
        exitCode: EXIT_CODES.NOPERM,
      },
    });
  });

  it('enables the policy from OPENCLI_READ_ONLY', () => {
    expect(() => enforceAdapterReadOnlyPolicy(command('write'), false, '1')).toThrow(ReadOnlyPolicyError);
    expect(() => enforceAdapterReadOnlyPolicy(command('write'), false, 'true')).toThrow(ReadOnlyPolicyError);
  });

  it('rejects ambiguous OPENCLI_READ_ONLY values', () => {
    expect(() => enforceAdapterReadOnlyPolicy(command('read'), false, 'yes')).toThrow(ArgumentError);
  });
});
