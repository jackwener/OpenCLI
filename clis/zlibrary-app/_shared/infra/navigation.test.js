import { describe, expect, it, vi } from 'vitest';
import { createPageMock } from '../../../test-utils.js';
import { navigateTo, PANELS } from './navigation.js';

const KNOWN_TARGETS = Object.keys(PANELS).sort();

describe('PANELS', () => {
    it('defines all 6 navigation targets', () => {
        expect(KNOWN_TARGETS).toEqual([
            'booklist',
            'downloads',
            'home',
            'my-library',
            'search',
            'z-recommend',
        ]);
    });

    it('each target has a non-empty selectors array and a label string', () => {
        for (const [key, panel] of Object.entries(PANELS)) {
            expect(Array.isArray(panel.selectors)).toBe(true);
            expect(panel.selectors.length).toBeGreaterThan(0);
            expect(typeof panel.label).toBe('string');
            expect(panel.label.length).toBeGreaterThan(0);
        }
    });

    it('all selectors are non-empty strings', () => {
        for (const [key, panel] of Object.entries(PANELS)) {
            for (const sel of panel.selectors) {
                expect(typeof sel).toBe('string');
                expect(sel.length).toBeGreaterThan(0);
            }
        }
    });

    it('rejects prototype-polluting keys via Object.hasOwn', () => {
        // Object.entries skips inherited props, but direct access should be guarded
        for (const key of ['__proto__', 'constructor', 'toString']) {
            expect(Object.hasOwn(PANELS, key)).toBe(false);
        }
    });

    it('selectors arrays are frozen (immutable)', () => {
        for (const panel of Object.values(PANELS)) {
            expect(Object.isFrozen(panel.selectors)).toBe(true);
        }
    });

    it('panel objects are frozen (immutable)', () => {
        for (const panel of Object.values(PANELS)) {
            expect(Object.isFrozen(panel)).toBe(true);
        }
    });
});

describe('navigateTo', () => {
    describe('happy path  -  element found and clicked', () => {
        for (const target of KNOWN_TARGETS) {
            it(`navigates to '${target}' when evaluate returns true`, async () => {
                const page = createPageMock([true]);
                const result = await navigateTo(page, target);
                expect(result).toEqual({ ok: true, reason: `clicked ${target} icon` });
            });
        }

        it('waits for SPA transition after successful click', async () => {
            const wait = vi.fn().mockResolvedValue(undefined);
            const page = createPageMock([true], { wait });
            await navigateTo(page, 'search');
            expect(wait).toHaveBeenCalledWith(1.5);
        });

        it('tolerates page.wait rejection after click (best-effort settling)', async () => {
            const page = createPageMock([true], {
                wait: vi.fn().mockRejectedValue(new Error('page closed during navigation')),
            });
            const result = await navigateTo(page, 'search');
            expect(result).toEqual({ ok: true, reason: 'clicked search icon' });
        });
    });

    describe('error path  -  element not found (all selectors fail)', () => {
        for (const target of KNOWN_TARGETS) {
            it(`returns failure for '${target}' when evaluate returns false`, async () => {
                const page = createPageMock([false]);
                const result = await navigateTo(page, target);
                expect(result).toEqual({ ok: false, reason: `icon not found: ${target}` });
            });
        }
    });

    describe('edge cases', () => {
        it('returns failure for unknown target name', async () => {
            const page = createPageMock([]);
            const result = await navigateTo(page, 'nonexistent');
            expect(result).toEqual({ ok: false, reason: 'unknown target: nonexistent' });
        });

        it('returns failure when page.evaluate throws an error', async () => {
            const page = createPageMock([], {
                evaluate: vi.fn().mockRejectedValue(new Error('DOM access denied')),
            });
            const result = await navigateTo(page, 'search');
            expect(result).toEqual({ ok: false, reason: 'navigation error: DOM access denied' });
        });

        it('returns failure when page object is null', async () => {
            const result = await navigateTo(null, 'search');
            expect(result).toEqual({ ok: false, reason: 'navigation error: invalid page object' });
        });

        it('returns failure when page has no evaluate method', async () => {
            const result = await navigateTo({}, 'search');
            expect(result).toEqual({ ok: false, reason: 'navigation error: invalid page object' });
        });

        it('does not call evaluate for unknown targets', async () => {
            const evaluate = vi.fn();
            const page = createPageMock([], { evaluate });
            await navigateTo(page, 'bogus-target');
            expect(evaluate).not.toHaveBeenCalled();
        });

        it('generates evaluate script with all target selectors', async () => {
            const evaluate = vi.fn().mockResolvedValue(true);
            const page = createPageMock([], { evaluate, wait: vi.fn().mockResolvedValue(undefined) });
            await navigateTo(page, 'search');
            const [script] = evaluate.mock.calls[0];
            expect(script).toContain('/search');
            expect(script).toContain('nav-icon-search');
            expect(script).toContain('data-testid');
        });

        it('calls evaluate exactly once for known target', async () => {
            const evaluate = vi.fn().mockResolvedValue(true);
            const page = createPageMock([], { evaluate });
            await navigateTo(page, 'search');
            expect(evaluate).toHaveBeenCalledTimes(1);
        });

        describe('prototype-key rejection', () => {
            const PROTO_KEYS = ['__proto__', 'constructor', 'toString'];

            for (const key of PROTO_KEYS) {
                it(`rejects '${key}' as unknown target`, async () => {
                    const evaluate = vi.fn();
                    const page = createPageMock([], { evaluate });
                    const result = await navigateTo(page, key);
                    expect(result).toEqual({ ok: false, reason: `unknown target: ${key}` });
                    expect(evaluate).not.toHaveBeenCalled();
                });
            }
        });

        describe('non-Error throw handling', () => {
            it('handles string throws from page.evaluate', async () => {
                const page = createPageMock([], {
                    evaluate: vi.fn().mockRejectedValue('access denied'),
                });
                const result = await navigateTo(page, 'search');
                expect(result).toEqual({ ok: false, reason: 'navigation error: access denied' });
            });

            it('handles null throws from page.evaluate', async () => {
                const page = createPageMock([], {
                    evaluate: vi.fn().mockRejectedValue(null),
                });
                const result = await navigateTo(page, 'search');
                expect(result).toEqual({ ok: false, reason: 'navigation error: null' });
            });
        });
    });
});
