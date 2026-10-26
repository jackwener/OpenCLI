/**
 * Xiaohongshu Notes in a Collection Board — 某个收藏专辑下的笔记.
 *
 *   opencli xiaohongshu collect-board "AI"        # by album name
 *   opencli xiaohongshu collect-board <board_id>  # by album id / board URL
 *
 * We open the profile → 收藏 → 专辑 list (which also lets us resolve a name to a
 * board id), then SPA-click the board card. A full-page goto to /board/<id>
 * SSR-renders the first page but fires no API, so we drive it via SPA click and
 * INTERCEPT the board/note requests, plus read the SSR store as a fallback.
 *
 * Notes are served by GET edith.xiaohongshu.com/api/sns/web/v1/board/note
 * (x-s signed). Targets the logged-in user's own 收藏 专辑.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrap, mapCollectedNote, matchBoard, resolveLoggedInUserId, fetchBoards } from './collect-helpers.js';

// Read the SSR-hydrated first page of board notes from the Pinia store.
async function readBoardStateNotes(page, boardId) {
    const notes = await page.evaluate(`
        (() => {
            const s = window.__INITIAL_STATE__ || {};
            const g = (x) => (x && x._value !== undefined ? x._value : x);
            const fm = g((g(s.board) || {}).boardFeedsMap) || {};
            const entry = g(fm[${JSON.stringify(boardId)}]) || {};
            return Array.isArray(entry.notes) ? entry.notes : [];
        })()
    `);
    return Array.isArray(notes) ? notes : [];
}

cli({
    site: 'xiaohongshu',
    name: 'collect-board',
    description: '小红书某个收藏专辑下的笔记 (收藏 > 专辑 > 笔记)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'board', type: 'string', positional: true, required: true, help: 'Board name, board id, or /board/<id> URL' },
        { name: 'limit', type: 'int', default: 30, help: 'Number of notes to return' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'type', 'likes', 'url'],
    func: async (page, kwargs) => {
        const limit = Math.max(1, Number(kwargs.limit ?? 30));

        // Open profile → 收藏 → 专辑 and list the boards (also resolves a name).
        await page.goto('https://www.xiaohongshu.com/');
        const userId = await resolveLoggedInUserId(page);
        const boards = await fetchBoards(page, userId);

        const board = matchBoard(boards, String(kwargs.board));
        if (!board) {
            const names = boards.map((b) => b.name).filter(Boolean);
            throw new ArgumentError(`No collection board named "${kwargs.board}". Available: ${names.length ? names.join(', ') : '(none)'}`);
        }
        const boardId = board.id;

        // Intercept the paginated board/note API, then SPA-click the board card
        // (preserves JS context, unlike a full goto) to trigger it.
        await page.installInterceptor('board/note');
        const clicked = await page.evaluate(`
            (() => {
                const link = document.querySelector('a[href*="/board/${boardId}"]');
                if (link) { link.click(); return true; }
                return false;
            })()
        `);
        if (!clicked) {
            // Fallback: navigate directly (first page comes from the SSR store).
            await page.goto(`https://www.xiaohongshu.com/board/${boardId}?source=web_user_page`);
        }
        await page.wait(2);
        try {
            await page.waitForCapture(6);
        } catch {
            // Direct-goto path fires no API; the SSR store still has page 1.
        }

        const seen = new Set();
        const rows = [];
        const collect = (note) => {
            const row = mapCollectedNote(note);
            if (!row || seen.has(row.id))
                return;
            seen.add(row.id);
            rows.push(row);
        };

        const maxScrolls = Math.ceil(limit / 30) + 5;
        for (let i = 0; i < maxScrolls; i++) {
            // Channel 1: intercepted board/note responses (snake_case).
            const requests = await page.getInterceptedRequests();
            for (const req of Array.isArray(requests) ? requests : []) {
                const notes = unwrap(req?.data)?.notes;
                for (const note of Array.isArray(notes) ? notes : [])
                    collect(note);
            }
            // Channel 2: SSR/store first page + appended pages (camelCase).
            for (const note of await readBoardStateNotes(page, boardId))
                collect(note);

            if (rows.length >= limit)
                break;
            await page.autoScroll({ times: 1, delayMs: 1800 });
            await page.wait(1);
        }

        if (rows.length === 0) {
            throw new EmptyResultError(`No notes found in board "${board.name || boardId}". It may be empty or private.`);
        }

        return rows.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
    },
});
