// tiktok-symphony delete — permanently remove a generation from the Library.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    DEEP_QUERY_SRC,
    HOST,
    LIBRARY_SCROLL_SRC,
    LIBRARY_URL,
    waitForValue,
} from './utils.js';

/**
 * Page-context source for the tile holding one asset, plus the state we need
 * from it. Images and clips are matched the same way `generations` reports
 * them: path segment for an image, `vid` query parameter for a clip.
 */
function tileStateSrc(assetId) {
    return `(() => {
        ${DEEP_QUERY_SRC}
        const want = ${JSON.stringify(assetId)};
        const media = __deepAll(document, (el) =>
            (el.tagName === 'IMG' && (el.src || '').includes('/ad-creative-sg/' + want + '~'))
            || (el.tagName === 'VIDEO' && (el.src || el.currentSrc || '').includes(want)))[0];
        if (!media) return null;
        return {
            mediaType: media.tagName === 'VIDEO' ? 'Video' : 'Image',
            mediaUrl: media.src || media.currentSrc || null,
        };
    })()`;
}

/**
 * Open the tile's overflow menu and click its Delete row.
 *
 * Both hops are keyed on the icon name (`more-horizontal`, then `delete`)
 * rather than on the label: the menu is localized, and its entries differ by
 * asset kind (an image offers Share/Generate video/Edit, a clip does not).
 * Everything is scoped to the tile, so a menu left open on another tile cannot
 * be the one we click.
 */
function openTileMenuSrc(assetId) {
    return `(() => {
        ${DEEP_QUERY_SRC}
        const want = ${JSON.stringify(assetId)};
        const media = __deepAll(document, (el) =>
            (el.tagName === 'IMG' && (el.src || '').includes('/ad-creative-sg/' + want + '~'))
            || (el.tagName === 'VIDEO' && (el.src || el.currentSrc || '').includes(want)))[0];
        if (!media) return null;
        media.scrollIntoView({ block: 'center' });

        let tile = media;
        for (let i = 0; i < 8 && tile; i++) {
            if (__deepAll(tile, (el) => __ksTag(el, 'ks-icon-more')).length) break;
            tile = tile.parentElement;
        }
        if (!tile) return null;
        const more = __deepAll(tile, (el) => __ksTag(el, 'ks-icon-more'))[0];
        if (!more) return null;

        let button = more;
        for (let i = 0; i < 4 && button; i++) {
            if (button.tagName === 'BUTTON') break;
            button = button.parentElement;
        }
        (button || more).click();
        window.__ocDeleteTile = tile;
        return true;
    })()`;
}

const CLICK_DELETE_ROW_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const tile = window.__ocDeleteTile;
    if (!tile) return null;
    const icon = __deepAll(tile, (el) => __ksTag(el, 'ks-icon') && el.getAttribute('name') === 'delete')[0];
    if (!icon) return null;
    // The row is the icon's parent; the label span next to it is what a user
    // clicks, and either bubbles to the same handler.
    (icon.parentElement || icon).click();
    return true;
})()`;

/** True once at least one asset tile has rendered anywhere in the grid. */
const ANY_ASSET_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const hit = __deepAll(document, (el) =>
        (el.tagName === 'IMG' && /ad-creative-sg/.test(el.src || ''))
        || (el.tagName === 'VIDEO' && !/lf-creative-factory/.test(el.src || el.currentSrc || '')
            && (el.src || el.currentSrc)))[0];
    return hit ? true : null;
})()`;

/** The confirm dialog, found by its shadow parts rather than its wording. */
const CONFIRM_SRC = `(() => {
    const modal = [...document.querySelectorAll('*')].filter((el) =>
        el.tagName.toLowerCase().startsWith('ks-modal') && el.shadowRoot
        && el.shadowRoot.querySelector('[part=confirmButton]'))
        .filter((el) => el.shadowRoot.querySelector('[part=confirmButton]').getBoundingClientRect().height > 0)[0];
    if (!modal) return null;
    const confirm = modal.shadowRoot.querySelector('[part=confirmButton]');
    const real = (confirm.shadowRoot && confirm.shadowRoot.querySelector('button')) || confirm;
    real.click();
    return true;
})()`;

cli({
    site: 'tiktok-symphony',
    name: 'delete',
    aliases: ['rm'],
    description: 'Permanently delete a generation from the Library (irreversible; requires --yes)',
    access: 'write',
    example: 'opencli tiktok-symphony delete 202607205d0d326f7499347f469b9861 --yes',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: LIBRARY_URL,
    // Library tiles mount lazily via IntersectionObserver. A background tab is
    // never rendered, so nothing intersects and the grid stays empty.
    defaultWindowMode: 'foreground',
    args: [
        { name: 'asset', type: 'string', required: true, positional: true, help: 'assetId from `generations`' },
        {
            name: 'yes',
            type: 'boolean',
            default: false,
            help: 'Actually delete. Without it the asset is only located and reported (status: dry-run)',
        },
    ],
    columns: ['assetId', 'status', 'type', 'url'],
    func: async (page, args) => {
        const assetId = String(args.asset ?? '').trim();
        if (!assetId) throw new ArgumentError('asset is required: pass an assetId from `generations`');
        if (!/^[A-Za-z0-9]+$/.test(assetId)) {
            throw new ArgumentError(`"${assetId}" is not a valid assetId (expected alphanumeric)`);
        }

        const stateSrc = tileStateSrc(assetId);

        // Let the grid mount something first. Searching a still-empty grid and
        // then scrolling past it would report "not found" for an asset that is
        // simply late.
        await waitForValue(page, ANY_ASSET_SRC, { label: 'Symphony Library grid', timeoutMs: 30000 });

        // Scroll the asset into the grid before doing anything destructive: a
        // tile that was never located must not be reported as deleted.
        let tile = await page.evaluate(stateSrc);
        for (let attempt = 0; !tile && attempt < 40; attempt++) {
            const scrolled = await page.evaluate(LIBRARY_SCROLL_SRC);
            await new Promise((r) => setTimeout(r, 1200));
            tile = await page.evaluate(stateSrc);
            if (!tile && scrolled?.atEnd) break;
        }
        if (!tile) {
            throw new EmptyResultError(
                'tiktok-symphony delete',
                `assetId ${assetId} was not found in the Library — check \`opencli tiktok-symphony generations\``,
            );
        }

        const row = { assetId, status: 'dry-run', type: tile.mediaType, url: tile.mediaUrl };
        if (!args.yes) return [row];

        if (!(await page.evaluate(openTileMenuSrc(assetId)))) {
            throw new CommandExecutionError(`could not open the overflow menu for ${assetId}`);
        }

        const opened = await waitForValue(page, CLICK_DELETE_ROW_SRC, {
            label: `Delete entry in the menu for ${assetId}`,
            timeoutMs: 10000,
            intervalMs: 500,
        }).catch(() => null);
        if (!opened) throw new CommandExecutionError(`the overflow menu for ${assetId} has no Delete entry`);

        const confirmed = await waitForValue(page, CONFIRM_SRC, {
            label: 'delete confirmation dialog',
            timeoutMs: 15000,
            intervalMs: 500,
        }).catch(() => null);
        if (!confirmed) {
            throw new CommandExecutionError('the delete confirmation dialog never appeared — nothing was deleted');
        }

        // Proof of deletion is the tile leaving the grid. Without this check the
        // command would report success for a click the site quietly ignored.
        const gone = await waitForValue(page, `(() => {
            const t = ${stateSrc};
            return t === null ? true : null;
        })()`, { label: `${assetId} to disappear`, timeoutMs: 20000, intervalMs: 1000 }).catch(() => null);
        if (!gone) {
            throw new CommandExecutionError(
                `${assetId} is still in the Library after confirming — the delete did not go through`,
            );
        }

        return [{ ...row, status: 'deleted' }];
    },
});
