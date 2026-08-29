import { expect, vi } from 'vitest';

export function makePage({ evaluateResult, cookies = [{ name: 'JSESSIONID', value: '"ajax:abc"' }] } = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookies),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

export async function expectRejectsWithMessage(promise, ErrorClass, message) {
    let error;
    try {
        await promise;
    } catch (e) {
        error = e;
    }
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.message).toBe(message);
}
