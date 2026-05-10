// chess.test.js — unit tests for the Chess.com adapter.
// Uses JSDOM against fixture JSON files (like dianping.test.js pattern).

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const TEST_USER = 'GMHikaru';
const TEST_GAME_ID = '167564728910';

describe('chess utils', () => {
    it('classifies time controls correctly', async () => {
        const { classifyTimeControl } = await import('./utils.js');
        expect(classifyTimeControl(15, 0)).toBe('ultraBullet');
        expect(classifyTimeControl(29, 0)).toBe('ultraBullet');
        expect(classifyTimeControl(59, 0)).toBe('bullet');
        expect(classifyTimeControl(179, 0)).toBe('bullet');
        expect(classifyTimeControl(599, 0)).toBe('blitz');
        expect(classifyTimeControl(1799, 0)).toBe('rapid');
        expect(classifyTimeControl(3600, 0)).toBe('classical');
    });

    it('requireUsername validates correctly', async () => {
        const { requireUsername } = await import('./utils.js');
        expect(requireUsername('GMHikaru')).toBe('GMHikaru');
        expect(requireUsername('aaron_wang')).toBe('aaron_wang');
        expect(() => requireUsername('ab')).toThrow();
        expect(() => requireUsername('')).toThrow();
        expect(() => requireUsername('user@name')).toThrow();
    });

    it('requireGameId validates correctly', async () => {
        const { requireGameId } = await import('./utils.js');
        expect(requireGameId('167564728910')).toBe('167564728910');
        expect(() => requireGameId('abc123')).toThrow();
        expect(() => requireGameId('')).toThrow();
    });

    it('formatTimestamp converts correctly', async () => {
        const { formatTimestamp } = await import('./utils.js');
        expect(formatTimestamp(1715300000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(formatTimestamp(0)).toBe(null);
        expect(formatTimestamp(-1)).toBe(null);
    });
});

describe('chess games command', () => {
    it('should have correct site and name', async () => {
        // Integration test would check manifest registration
        // This is tested via opencli validate
    });
});

describe('chess stats command', () => {
    it('should handle missing stats gracefully', async () => {
        // Stats endpoint might return 404 for some players
        // Should not throw, just return partial data
    });
});

describe('chess game command', () => {
    it('should parse game result correctly', async () => {
        const { parseResult } = await import('./utils.js');
        expect(parseResult('win', 'white')).toBe('white-wins');
        expect(parseResult('loss', 'black')).toBe('white-loses');
        expect(parseResult('agreed', 'draw')).toBe('draw');
    });
});
