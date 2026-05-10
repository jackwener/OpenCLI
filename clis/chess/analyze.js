// chess analyze — open a Chess.com game in browser for visual analysis.
// This command uses the browser-based approach for full game visualization.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireGameId } from './utils.js';

cli({
    site: 'chess',
    name: 'analyze',
    access: 'read',
    description: 'Open a Chess.com game in browser for visual analysis with board, moves, and evaluation',
    domain: 'www.chess.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'gameId', positional: true, required: true, help: 'Chess.com game ID' },
    ],
    columns: ['gameId', 'url', 'status'],
    pipeline: [
        { navigate: 'https://www.chess.com/game/live/${{ args.gameId }}' },
        { wait: 3000 },
        { evaluate: `
(async () => {
    // Check if game loaded
    const board = document.querySelector('.board');
    const gameInfo = document.querySelector('.game-info');
    const moves = document.querySelector('.moves');
    return {
        boardFound: !!board,
        gameInfoFound: !!gameInfo,
        movesFound: !!moves,
        url: window.location.href,
        status: board ? 'loaded' : 'not-loaded'
    };
})()
` },
        { map: {
                gameId: '${{ args.gameId }}',
                url: '${{ item.url }}',
                status: '${{ item.status }}',
            } },
    ],
});

// Helper command: extract game state snapshot for AI agent analysis
cli({
    site: 'chess',
    name: 'snapshot',
    access: 'read',
    description: 'Extract current game state (board position, move list, clock, eval) as structured data',
    domain: 'www.chess.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'gameId', positional: true, required: true, help: 'Chess.com game ID' },
    ],
    columns: ['gameId', 'turn', 'fen', 'moveList', 'evaluation', 'clock', 'result'],
    pipeline: [
        { navigate: 'https://www.chess.com/game/live/${{ args.gameId }}' },
        { wait: 2500 },
        { evaluate: `
(async () => {
    // Extract move list text
    const movesEl = document.querySelector('.moves');
    const moveText = movesEl ? movesEl.innerText : '';

    // Extract clock times
    const clocks = document.querySelectorAll('.clock');
    const whiteClock = clocks[0]?.textContent || null;
    const blackClock = clocks[1]?.textContent || null;

    // Extract evaluation bar (if present)
    const evalBar = document.querySelector('.eval-bar');
    const evalText = evalBar ? evalBar.innerText : null;

    // Check game result
    const resultEl = document.querySelector('.game-result');
    const result = resultEl ? resultEl.innerText : null;

    // Get current turn (look for active piece or last move highlight)
    const lastMove = document.querySelector('.move.highlighted, .square.last-move');
    const turn = lastMove ? 'black' : 'white'; // Simplified, ideally parse from board

    // Get board FEN - this is complex,Chess.com doesn't expose FEN directly
    // We'll return the move list which can be converted to FEN by analysis tools
    return {
        moveList: moveText,
        whiteClock,
        blackClock,
        evaluation: evalText,
        result,
        turn: 'unknown', // Better to parse from actual board
    };
})()
` },
        { map: {
                gameId: '${{ args.gameId }}',
                turn: '${{ item.turn }}',
                fen: null,
                moveList: '${{ item.moveList }}',
                evaluation: '${{ item.evaluation }}',
                clock: '${{ item.whiteClock }} / ${{ item.blackClock }}',
                result: '${{ item.result }}',
            } },
    ],
});
