import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './item.js';
import './wayback.js';
import './snapshots.js';

describe('archive adapter registry contracts', () => {
    it('declares archive search columns so identifier round-trips into archive item', () => {
        const search = getRegistry().get('archive/search');
        const item = getRegistry().get('archive/item');

        expect(search).toBeDefined();
        expect(item).toBeDefined();
        expect(search.columns).toEqual(['rank', 'identifier', 'title', 'creator', 'date', 'mediatype', 'downloads', 'url']);
        expect(item.columns).toContain('identifier');
    });

    it('declares wayback and snapshots columns so URL round-trips between them', () => {
        const wayback = getRegistry().get('archive/wayback');
        const snapshots = getRegistry().get('archive/snapshots');

        expect(wayback).toBeDefined();
        expect(snapshots).toBeDefined();
        expect(wayback.columns).toContain('snapshot_url');
        expect(snapshots.columns).toContain('snapshot_url');
        expect(wayback.columns).toContain('original_url');
        expect(snapshots.columns).toContain('original_url');
    });

    it('marks every archive command as read access on the archive.org domain', () => {
        for (const name of ['search', 'item', 'wayback', 'snapshots']) {
            const cmd = getRegistry().get(`archive/${name}`);
            expect(cmd, name).toBeDefined();
            expect(cmd.access, name).toBe('read');
            expect(cmd.domain, name).toBe('archive.org');
            expect(cmd.browser, name).toBe(false);
        }
    });
});
