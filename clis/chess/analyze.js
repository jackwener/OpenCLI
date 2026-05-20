/**
 * Open a Chess.com game in the browser's analysis view. Thin wrapper:
 * navigates the bound session to the `/analysis` form of the game URL
 * and reports the resolved page URL.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseGameUrl } from './utils.js';

cli({
    site: 'chess',
    name: 'analyze',
    access: 'read',
    description: 'Open a Chess.com game in the browser analysis board',
    domain: 'www.chess.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'game-url', type: 'string', required: true, positional: true, help: 'Full game URL, e.g. https://www.chess.com/game/live/168842570216' },
    ],
    columns: ['kind', 'game_id', 'analysis_url'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for chess analyze');
        const { kind, id } = parseGameUrl(kwargs['game-url']);
        const analysisUrl = `https://www.chess.com/analysis/game/${kind}/${id}`;
        try {
            await page.goto(analysisUrl);
            await page.wait(2);
        } catch (error) {
            throw new CommandExecutionError(`Failed to open Chess.com analysis board: ${error?.message || error}`);
        }
        return [{ kind, game_id: id, analysis_url: analysisUrl }];
    },
});
