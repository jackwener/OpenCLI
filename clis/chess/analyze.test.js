import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '../../cli-manifest.json');

function loadManifestCommand(name) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest.find(cmd => cmd.site === 'chess' && cmd.name === name);
}

function makePage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

describe('chess analyze command', () => {
    it('navigates to /analysis/game/<kind>/<id> and reports the URL', async () => {
        const cmd = getRegistry().get('chess/analyze');
        const page = makePage();
        const rows = await cmd.func(page, { 'game-url': 'https://www.chess.com/game/live/42' });
        expect(rows).toEqual([{ kind: 'live', game_id: '42', analysis_url: 'https://www.chess.com/analysis/game/live/42' }]);
        expect(page.goto).toHaveBeenCalledWith('https://www.chess.com/analysis/game/live/42');
    });

    it('preserves daily kind in the analysis URL', async () => {
        const cmd = getRegistry().get('chess/analyze');
        const page = makePage();
        const rows = await cmd.func(page, { 'game-url': 'https://www.chess.com/game/daily/123' });
        expect(rows[0].analysis_url).toBe('https://www.chess.com/analysis/game/daily/123');
    });

    it('rejects invalid URL with ArgumentError before navigation', async () => {
        const cmd = getRegistry().get('chess/analyze');
        const page = makePage();
        await expect(cmd.func(page, { 'game-url': 'not-a-url' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws CommandExecutionError without a browser page', async () => {
        const cmd = getRegistry().get('chess/analyze');
        await expect(cmd.func(null, { 'game-url': 'https://www.chess.com/game/live/42' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when browser navigation fails', async () => {
        const cmd = getRegistry().get('chess/analyze');
        const page = makePage();
        page.goto.mockRejectedValue(new Error('navigation failed'));
        await expect(cmd.func(page, { 'game-url': 'https://www.chess.com/game/live/42' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('registers with the expected columns + browser flag', () => {
        const cmd = getRegistry().get('chess/analyze');
        expect(cmd?.columns).toEqual(['kind', 'game_id', 'analysis_url']);
        expect(cmd?.browser).toBe(true);
        expect(cmd?.navigateBefore).toBe(false);
    });

    it('build manifest keeps analyze pre-navigation disabled and game source attribution stable', () => {
        expect(loadManifestCommand('analyze')).toMatchObject({
            navigateBefore: false,
            modulePath: 'chess/analyze.js',
            sourceFile: 'chess/analyze.js',
        });
        expect(loadManifestCommand('game')).toMatchObject({
            modulePath: 'chess/game.js',
            sourceFile: 'chess/game.js',
        });
    });
});
