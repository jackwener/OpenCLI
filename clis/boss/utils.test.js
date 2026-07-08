import { describe, expect, it } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { assertOk } from './utils.js';

describe('assertOk', () => {
    it('returns silently on code 0', () => {
        expect(() => assertOk({ code: 0 })).not.toThrow();
    });

    it('maps expired cookie codes (7, 37) to AuthRequiredError', () => {
        expect(() => assertOk({ code: 7, message: 'expired' })).toThrow(AuthRequiredError);
        expect(() => assertOk({ code: 37, message: 'expired' })).toThrow(AuthRequiredError);
    });

    it('maps code 24 (identity mismatch) to AuthRequiredError with recruiter-only hint', () => {
        try {
            assertOk({ code: 24, message: '请切换身份后再试' });
            throw new Error('assertOk should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(AuthRequiredError);
            expect(String(err.message)).toContain('招聘端');
        }
    });

    it('falls through to CommandExecutionError for other non-zero codes', () => {
        expect(() => assertOk({ code: 99, message: 'something else' }))
            .toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError on malformed (non-object) response', () => {
        expect(() => assertOk(null)).toThrow(CommandExecutionError);
        expect(() => assertOk('not-an-object')).toThrow(CommandExecutionError);
    });
});
