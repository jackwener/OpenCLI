// chess game — fetch a single game's details and PGN.
//
// Primary: REST API at /pub/game/{game_id}
// Fallback: Browser-based Share → Copy PGN flow when API PGN is corrupted.
//
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CHESS_COM_API, classifyTimeControl, chessComFetch, formatTimestamp, parseResult, requireGameId } from './utils.js';

cli({
    site: 'chess',
    name: 'game',
    access: 'read',
    description: 'Get details and PGN for a specific Chess.com game by game ID',
    domain: 'www.chess.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'gameId', positional: true, required: true, help: 'Chess.com game ID (numeric)' },
        { name: 'pgn', type: 'boolean', default: false, help: 'Return full PGN instead of table' },
    ],
    columns: ['gameId', 'date', 'white', 'whiteRating', 'black', 'blackRating', 'result', 'timeControl', 'eco', 'opening', 'moves', 'url'],
    func: async (args) => {
        const gameId = requireGameId(args.gameId);
        const url = `${CHESS_COM_API}/game/${gameId}`;

        let body;
        try {
            body = await chessComFetch(url, 'chess game');
        }
        catch (err) {
            throw err;
        }

        if (!body || !body.game_id) {
            throw new EmptyResultError('chess game', `Game ${gameId} not found.`);
        }

        const g = body;
        const whiteUsername = g.white?.username || 'anonymous';
        const blackUsername = g.black?.username || 'anonymous';

        // Result from white's perspective
        let result = 'unknown';
        if (g.white?.result) {
            const wr = g.white.result.toLowerCase();
            if (wr.includes('win')) result = '1-0';
            else if (wr.includes('loss')) result = '0-1';
            else if (wr.includes('draw') || wr === 'agreed' || wr === '1/2-1/2') result = '1/2-1/2';
        }

        const baseResult = {
            gameId: g.game_id,
            date: formatTimestamp(g.end_time),
            white: whiteUsername,
            whiteRating: g.white?.rating || null,
            black: blackUsername,
            blackRating: g.black?.rating || null,
            result,
            timeControl: classifyTimeControl(g.time_class || 'rapid'),
            eco: g.eco || null,
            opening: g.opening?.name || null,
            moves: g.moves || null,
            url: g.url || `https://www.chess.com/game/live/${gameId}`,
        };

        // If pgn flag is set, return full PGN
        if (args.pgn && g.pgn) {
            baseResult.pgn = g.pgn;
        }

        return [baseResult];
    },
});

// Also support opening via browser for PGN extraction
cli({
    site: 'chess',
    name: 'pgn',
    access: 'read',
    description: 'Get PGN for a game via browser (Share → Copy PGN flow)',
    domain: 'www.chess.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'gameId', positional: true, required: true, help: 'Chess.com game ID' },
    ],
    columns: ['gameId', 'pgn'],
    pipeline: [
        { navigate: 'https://www.chess.com/game/live/${{ args.gameId }}' },
        { wait: 2000 },
        // Click the share button (usually in the game info panel)
        { evaluate: `
(async () => {
    // Try to find and click the share button
    const shareBtn = document.querySelector('button[aria-label*="share"], button[aria-label*="Share"], .share-button, [data-test="share-button"]');
    if (shareBtn) {
        shareBtn.click();
        return { clicked: true, found: true };
    }
    // Alternative: look for the share icon
    const icons = document.querySelectorAll('svg');
    for (const icon of icons) {
        const parent = icon.closest('button');
        if (parent && (parent.textContent.includes('Share') || parent.getAttribute('aria-label')?.includes('share'))) {
            parent.click();
            return { clicked: true, found: true };
        }
    }
    return { clicked: false, found: false };
})()
` },
        { wait: 1500 },
        // After share dialog opens, find PGN button and click
        { evaluate: `
(async () => {
    const dialog = document.querySelector('[role="dialog"], .share-dialog, .modal');
    if (!dialog) return { dialog: false };

    const pgnBtn = Array.from(dialog.querySelectorAll('button, a')).find(
        el => el.textContent.includes('PGN') || el.textContent.includes('pgn')
    );
    if (pgnBtn) {
        pgnBtn.click();
        return { pgnBtnClicked: true };
    }
    return { pgnBtnClicked: false };
})()
` },
        { wait: 1000 },
        // Extract the PGN text
        { evaluate: `
(async () => {
    // Look for textarea or pre containing PGN
    const pre = document.querySelector('pre[data-testid="pgn-textarea"], textarea[readonly], pre.pgn-text');
    if (pre) {
        return { pgn: pre.textContent || pre.value };
    }
    // Alternative: copy button text
    const copyArea = document.querySelector('[data-testid="copy-pgn"], .copy-pgn-section');
    if (copyArea) {
        return { pgn: copyArea.textContent };
    }
    // Fall back to board section content
    return { pgn: null };
})()
` },
        { map: {
                gameId: '${{ args.gameId }}',
                pgn: '${{ item.pgn }}',
            } },
    ],
});
