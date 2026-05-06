import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './drug-label.js';
import './food-recall.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleLabel = {
    id: 'abcde-12345',
    effective_time: '20250101',
    purpose: ['Pain reliever'],
    indications_and_usage: ['For temporary relief of minor aches and pains.'],
    warnings: ['Allergy alert: do not use if you are allergic to NSAIDs.'],
    dosage_and_administration: ['Take 1-2 tablets every 4-6 hours.'],
    openfda: {
        brand_name: ['Aspirin Bayer'],
        generic_name: ['ASPIRIN'],
        manufacturer_name: ['Bayer HealthCare LLC'],
        product_type: ['HUMAN OTC DRUG'],
        route: ['ORAL'],
        product_ndc: ['0280-1234'],
        pharm_class_epc: ['Nonsteroidal Anti-inflammatory Drug [EPC]'],
    },
};

const sampleRecall = {
    recall_number: 'F-1234-2026',
    status: 'Ongoing',
    classification: 'Class I',
    voluntary_mandated: 'Voluntary',
    recalling_firm: 'Acme Foods Inc',
    city: 'Atlanta', state: 'GA', country: 'United States',
    product_description: 'Acme Salad Mix 12oz',
    reason_for_recall: 'Listeria monocytogenes contamination',
    product_quantity: '20000 cases',
    distribution_pattern: 'Nationwide',
    report_date: '20260415',
    recall_initiation_date: '20260410',
    termination_date: null,
};

describe('openfda drug-label', () => {
    const cmd = getRegistry().get('openfda/drug-label');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --limit out of range', async () => {
        await expect(cmd.func({ query: 'aspirin', limit: 99 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })));
        await expect(cmd.func({ query: 'unobtainium' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes drug-label rows + collapses 1-elem arrays', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results: [sampleLabel] }), { status: 200 })));
        const rows = await cmd.func({ query: 'aspirin', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1, brandName: 'Aspirin Bayer', genericName: 'ASPIRIN',
            manufacturer: 'Bayer HealthCare LLC', purpose: 'Pain reliever',
            pharmClass: 'Nonsteroidal Anti-inflammatory Drug [EPC]',
        });
    });

    it('uses brand OR generic search instead of requiring both fields to match', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify({ results: [sampleLabel] }), { status: 200 }));
        });
        await cmd.func({ query: 'tylenol', limit: 1 });
        expect(calls[0]).toContain('+OR+');
        expect(calls[0]).toContain('openfda.brand_name');
        expect(calls[0]).toContain('openfda.generic_name');
    });
});

describe('openfda food-recall', () => {
    const cmd = getRegistry().get('openfda/food-recall');

    it('promotes 429 to CommandExecutionError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('rate', { status: 429 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('shapes food-recall rows + carries report_date', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results: [sampleRecall] }), { status: 200 })));
        const rows = await cmd.func({ classification: 'Class I' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1, recallNumber: 'F-1234-2026', status: 'Ongoing',
            classification: 'Class I', recallingFirm: 'Acme Foods Inc',
            reportDate: '20260415',
        });
    });

    it('threads --query AND --status into Lucene query string', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify({ results: [sampleRecall] }), { status: 200 }));
        });
        await cmd.func({ query: 'salmonella', status: 'Ongoing' });
        // Verify both clauses survived URL encoding (the literal `+AND+` should NOT be percent-escaped).
        expect(calls[0]).toContain('+AND+');
        expect(calls[0]).toContain('salmonella');
    });
});
