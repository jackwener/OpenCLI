import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './pokemon.js';
import './move.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('pokeapi pokemon', () => {
    const cmd = getRegistry().get('pokeapi/pokemon');

    it('rejects empty ref', async () => {
        await expect(cmd.func({ ref: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects structurally-bad name', async () => {
        await expect(cmd.func({ ref: '!!!' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('Not Found', { status: 404 })));
        await expect(cmd.func({ ref: 'missingno' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a pokemon row with stats + types + abilities', async () => {
        const sample = {
            id: 25, name: 'pikachu', height: 4, weight: 60, base_experience: 112,
            stats: [
                { base_stat: 35, stat: { name: 'hp' } },
                { base_stat: 55, stat: { name: 'attack' } },
                { base_stat: 40, stat: { name: 'defense' } },
                { base_stat: 50, stat: { name: 'special-attack' } },
                { base_stat: 50, stat: { name: 'special-defense' } },
                { base_stat: 90, stat: { name: 'speed' } },
            ],
            types: [{ slot: 1, type: { name: 'electric' } }],
            abilities: [
                { slot: 1, is_hidden: false, ability: { name: 'static' } },
                { slot: 3, is_hidden: true, ability: { name: 'lightning-rod' } },
            ],
            sprites: { front_default: 'https://x/y.png', other: { 'official-artwork': { front_default: 'https://art/y.png' } } },
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ ref: 'pikachu' });
        expect(rows[0].id).toBe(25);
        expect(rows[0].heightM).toBe(0.4);
        expect(rows[0].weightKg).toBe(6);
        expect(rows[0].types).toBe('electric');
        expect(rows[0].abilities).toBe('static, lightning-rod (hidden)');
        expect(rows[0].totalStats).toBe(320);
    });
});

describe('pokeapi move', () => {
    const cmd = getRegistry().get('pokeapi/move');

    it('rejects empty ref', async () => {
        await expect(cmd.func({ ref: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a move row + picks latest English flavor text', async () => {
        const sample = {
            id: 85, name: 'thunderbolt',
            type: { name: 'electric' }, damage_class: { name: 'special' },
            power: 90, accuracy: 100, pp: 15, priority: 0, effect_chance: 10,
            target: { name: 'selected-pokemon' }, generation: { name: 'generation-i' },
            names: [
                { language: { name: 'en' }, name: 'Thunderbolt' },
                { language: { name: 'ja' }, name: '10まんボルト' },
            ],
            flavor_text_entries: [
                { language: { name: 'en' }, flavor_text: 'Old text' },
                { language: { name: 'en' }, flavor_text: 'A strong electric blast.' },
            ],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ ref: 'thunderbolt' });
        expect(rows[0].displayName).toBe('Thunderbolt');
        expect(rows[0].flavorText).toBe('A strong electric blast.');
        expect(rows[0].damageClass).toBe('special');
        expect(rows[0].power).toBe(90);
    });
});
