import { AuthRequiredError, SelectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { isEmptyListsState, parseListCards } from './lists-parser.js';

const LIST_DETAIL_PATH_RE = /^\/i\/lists\/\d+$/;
const MEMBER_TEXT_RE = /(members?|位成员)/i;
const FOLLOWER_TEXT_RE = /(followers?|位关注者)/i;
const DETAIL_CHROME_LINE_RE = /^(to view keyboard shortcuts, press question mark|view keyboard shortcuts|home|explore|see new posts|lists)$/i;

function hasListMetrics(text) {
    return MEMBER_TEXT_RE.test(text) && FOLLOWER_TEXT_RE.test(text);
}

function stripLeadingChromeLines(text) {
    const lines = String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    while (lines.length && DETAIL_CHROME_LINE_RE.test(lines[0])) {
        lines.shift();
    }
    return lines.join('\n');
}

function composeDetailText(primaryText, bodyText) {
    const cleanPrimaryText = stripLeadingChromeLines(primaryText);
    const cleanBodyText = stripLeadingChromeLines(bodyText);
    if (hasListMetrics(cleanPrimaryText)) {
        return cleanPrimaryText;
    }
    if (!cleanPrimaryText) {
        return cleanBodyText;
    }
    if (!hasListMetrics(cleanBodyText)) {
        return cleanPrimaryText;
    }
    const metricLines = String(cleanBodyText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => MEMBER_TEXT_RE.test(line) || FOLLOWER_TEXT_RE.test(line) || /\bprivate\b/i.test(line) || /\bpublic\b/i.test(line) || /锁定列表/.test(line));
    return [cleanPrimaryText, ...metricLines].filter(Boolean).join('\n');
}

function normalizeOverviewCells(cells) {
    if (!Array.isArray(cells)) {
        return [];
    }
    return cells.map((cell, index) => {
        if (typeof cell === 'string') {
            return {
                preview: cell,
                signature: cell || `__cell_${index}`,
            };
        }
        return {
            preview: String(cell?.preview || ''),
            signature: String(cell?.signature || cell?.preview || `__cell_${index}`),
        };
    });
}

async function readOverviewData(page) {
    let overviewData = { cells: [], listCount: 0, readyCellCount: 0, pageText: '' };
    for (let attempt = 0; attempt < 3; attempt++) {
        overviewData = await page.evaluate(`() => ({
            cells: Array.from(document.querySelectorAll('[data-testid="listCell"]'))
                .map((cell, index) => {
                const preview = (cell.innerText || '').trim();
                const imageSrc = cell.querySelector('img')?.getAttribute('src') || '';
                const backgroundStyle = cell.querySelector('[style*="background-image"]')?.getAttribute('style') || '';
                return {
                    preview,
                    signature: [preview, imageSrc, backgroundStyle].filter(Boolean).join('|') || '__cell_' + index,
                };
            }),
            pageText: document.body.innerText || '',
        })`);
        overviewData.cells = normalizeOverviewCells(overviewData.cells);
        overviewData.listCount = overviewData.cells.length || Number(overviewData.listCount || 0);
        overviewData.readyCellCount = overviewData.cells.length
            ? overviewData.cells.filter((cell) => cell.preview).length
            : Number(overviewData.listCount || 0);
        if (overviewData.pageText && (overviewData.readyCellCount || isEmptyListsState(overviewData.pageText))) {
            break;
        }
        if (attempt < 2) {
            await page.wait(1);
        }
    }
    return overviewData;
}

async function readDetailData(page) {
    let detailData = { href: '', primaryText: '', text: '' };
    let detailPath = '';
    let detailText = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        detailData = await page.evaluate(`() => ({
            href: window.location.href || '',
            primaryText: document.querySelector('[data-testid="primaryColumn"]')?.innerText || '',
            text: document.body.innerText || '',
        })`);
        try {
            detailPath = new URL(detailData?.href || '', 'https://x.com').pathname;
        }
        catch {
            detailPath = '';
        }
        const primaryText = detailData?.primaryText || '';
        const bodyText = detailData?.text || '';
        detailText = composeDetailText(primaryText, bodyText);
        if (LIST_DETAIL_PATH_RE.test(detailPath) && hasListMetrics(detailText)) {
            break;
        }
        if (attempt < 2) {
            await page.wait(1);
        }
    }
    return {
        detailData,
        detailPath,
        detailText,
    };
}

cli({
    site: 'twitter',
    name: 'lists',
    description: 'Get Twitter/X lists for a user',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'user', positional: true, type: 'string', required: false },
        { name: 'limit', type: 'int', default: 50 },
    ],
    columns: ['name', 'members', 'followers', 'mode'],
    func: async (page, kwargs) => {
        let targetUser = kwargs.user;
        if (!targetUser) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = await page.evaluate(`() => {
            const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            return link ? link.getAttribute('href') : null;
        }`);
            if (!href) {
                throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
            }
            targetUser = href.replace('/', '');
        }
        const overviewUrl = `https://x.com/${targetUser}/lists`;
        await page.goto(overviewUrl);
        await page.wait(3);
        let overviewData = await readOverviewData(page);
        if (!overviewData?.pageText) {
            throw new SelectorError('Twitter lists', 'Empty page text');
        }
        if (!overviewData.readyCellCount) {
            if (isEmptyListsState(overviewData.pageText)) {
                return [];
            }
            throw new SelectorError('Twitter lists', 'Could not find list cells');
        }
        const results = [];
        const seenDetailPaths = new Set();
        const seenCellSignatures = new Set();
        let maxObservedListCount = overviewData.listCount;
        let maxObservedReadyCellCount = overviewData.readyCellCount;
        while (results.length < kwargs.limit) {
            if (results.length > 0) {
                await page.goto(overviewUrl);
                await page.wait(3);
                overviewData = await readOverviewData(page);
            }
            maxObservedListCount = Math.max(maxObservedListCount, overviewData.listCount);
            maxObservedReadyCellCount = Math.max(maxObservedReadyCellCount, overviewData.readyCellCount);
            if (!overviewData.readyCellCount) {
                if (results.length < Math.min(kwargs.limit, maxObservedListCount)) {
                    throw new SelectorError('Twitter lists', 'Could not find additional list cells');
                }
                break;
            }
            if (overviewData.cells.length
                && overviewData.cells
                    .filter((cell) => cell.preview)
                    .every((cell) => seenCellSignatures.has(cell.signature))
                && results.length >= Math.min(kwargs.limit, maxObservedReadyCellCount)) {
                break;
            }
            let foundNewList = false;
            const attemptedIndices = new Set();
            let overviewSignature = JSON.stringify(overviewData.cells.map((cell) => `${cell.preview}|${cell.signature}`));
            while (attemptedIndices.size < overviewData.listCount) {
                const candidateIndices = Array.from({ length: overviewData.listCount }, (_, currentIndex) => currentIndex)
                    .filter((currentIndex) => !attemptedIndices.has(currentIndex))
                    .filter((currentIndex) => !overviewData.cells.length || !!overviewData.cells[currentIndex]?.preview)
                    .sort((left, right) => {
                    const leftBlank = !overviewData.cells[left]?.preview;
                    const rightBlank = !overviewData.cells[right]?.preview;
                    const leftSeen = overviewData.cells[left] && seenCellSignatures.has(overviewData.cells[left].signature);
                    const rightSeen = overviewData.cells[right] && seenCellSignatures.has(overviewData.cells[right].signature);
                    return Number(leftBlank) - Number(rightBlank)
                        || Number(leftSeen) - Number(rightSeen)
                        || left - right;
                });
                if (candidateIndices.length === 0) {
                    break;
                }
                const currentIndex = candidateIndices[0];
                attemptedIndices.add(currentIndex);
                const clicked = await page.evaluate(`() => {
                    const cells = Array.from(document.querySelectorAll('[data-testid="listCell"]'));
                    const cell = cells[${currentIndex}];
                    if (!cell) return false;
                    cell.click();
                    return true;
                }`);
                if (!clicked) {
                    throw new SelectorError('Twitter list cell', `Could not open list at index ${currentIndex}`);
                }
                await page.wait(3);
                const { detailData, detailPath, detailText } = await readDetailData(page);
                if (!LIST_DETAIL_PATH_RE.test(detailPath)) {
                    throw new SelectorError('Twitter list detail', 'Did not navigate to a list detail page');
                }
                if (!detailText) {
                    throw new SelectorError('Twitter list detail', 'Empty page text');
                }
                if (!hasListMetrics(detailText)) {
                    throw new SelectorError('Twitter list detail', 'List metrics did not load');
                }
                const parsed = parseListCards([{ href: detailData.href, text: detailText }]);
                if (parsed.length === 0) {
                    throw new SelectorError('Twitter lists', 'Could not parse list detail');
                }
                const cellSignature = overviewData.cells[currentIndex]?.signature || parsed[0].name;
                seenCellSignatures.add(cellSignature);
                if (seenDetailPaths.has(detailPath)) {
                    if (attemptedIndices.size < overviewData.listCount) {
                        await page.goto(overviewUrl);
                        await page.wait(3);
                        overviewData = await readOverviewData(page);
                        maxObservedListCount = Math.max(maxObservedListCount, overviewData.listCount);
                        maxObservedReadyCellCount = Math.max(maxObservedReadyCellCount, overviewData.readyCellCount);
                        const nextSignature = JSON.stringify(overviewData.cells.map((cell) => `${cell.preview}|${cell.signature}`));
                        if (nextSignature !== overviewSignature) {
                            attemptedIndices.clear();
                        }
                        overviewSignature = nextSignature;
                    }
                    continue;
                }
                seenDetailPaths.add(detailPath);
                results.push(parsed[0]);
                foundNewList = true;
                break;
            }
            if (!foundNewList) {
                if (results.length < Math.min(kwargs.limit, maxObservedReadyCellCount)) {
                    throw new SelectorError('Twitter lists', 'Could not find additional list cells');
                }
                break;
            }
        }
        return results;
    }
});
