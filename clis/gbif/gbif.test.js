import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './species.js';
import './occurrence.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('gbif species', () => {
    const cmd = getRegistry().get('gbif/species');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --limit > 100', async () => {
        await expect(cmd.func({ query: 'lion', limit: 500 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty results to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'zzz123' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a species row and prefers nubKey + carries lineage from Backbone', async () => {
        const sample = {
            results: [{
                key: 999, nubKey: 5219404,
                scientificName: 'Panthera leo (Linnaeus, 1758)',
                canonicalName: 'Panthera leo',
                rank: 'SPECIES', taxonomicStatus: 'ACCEPTED',
                kingdom: 'Animalia', phylum: 'Chordata', class: 'Mammalia',
                order: 'Carnivora', family: 'Felidae', genus: 'Panthera',
                species: 'Panthera leo',
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ query: 'lion' });
        expect(rows[0].taxonKey).toBe(5219404);
        expect(rows[0].canonicalName).toBe('Panthera leo');
        expect(rows[0].kingdom).toBe('Animalia');
        expect(rows[0].class).toBe('Mammalia');
        expect(rows[0].url).toBe('https://www.gbif.org/species/5219404');
    });
});

describe('gbif occurrence', () => {
    const cmd = getRegistry().get('gbif/occurrence');

    it('rejects calls with neither --taxon-key nor --query', async () => {
        await expect(cmd.func({})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects bad country code', async () => {
        await expect(cmd.func({ query: 'Panthera leo', country: 'usa' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes an occurrence row', async () => {
        const sample = {
            results: [{
                key: 1234567,
                taxonKey: 5219404,
                scientificName: 'Panthera leo',
                eventDate: '2024-08-12',
                country: 'KE', stateProvince: 'Maasai Mara',
                decimalLatitude: -1.5, decimalLongitude: 35.0,
                basisOfRecord: 'HUMAN_OBSERVATION',
                datasetName: 'iNaturalist',
                recordedBy: 'jdoe',
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ 'taxon-key': '5219404' });
        expect(rows[0].occurrenceKey).toBe(1234567);
        expect(rows[0].latitude).toBe(-1.5);
        expect(rows[0].url).toBe('https://www.gbif.org/occurrence/1234567');
    });
});
