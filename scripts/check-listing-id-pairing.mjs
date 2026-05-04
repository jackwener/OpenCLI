#!/usr/bin/env node
/**
 * check-listing-id-pairing.mjs — advisory report on listing↔detail id round-tripping.
 *
 * Soft convention (NOT a CI gate): when a site exposes both a listing-class
 * command (search / hot / recent / trending / top / feed / popular / new /
 * list) AND a detail-class command (read / article / paper / post / detail /
 * view / job / page / book / movie / show / chapter / question / answer /
 * tweet / video / track), it's usually nicer for agents if every listing row
 * carries an id-shaped column whose value round-trips into the detail
 * command. Without that, the agent has to re-search by title or scrape a URL
 * to follow up.
 *
 * Why advisory and not a gate: whether a listing should pair with a detail
 * is a case-by-case product/UX call (topic-string trending, profile-attribute
 * key/value rows, UI-only sessions etc. legitimately don't pair). Forcing
 * authors through an exempt list every PR was higher cognitive cost than the
 * silent-loss bugs the rule actually catches. See PR #1311 thread for the
 * "anti-pattern vs case-by-case" filter.
 *
 * What this script does:
 *  1. Group cli-manifest.json entries by site.
 *  2. For each site that has both classes, walk every listing entry and
 *     check `columns` for at least one id-shaped name.
 *  3. Print a report. Always exits 0 — never fails CI.
 *
 * Usage:
 *   node scripts/check-listing-id-pairing.mjs   # print advisory report
 *   npm run advise:listing-id-pairing
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(__dirname, '..', 'cli-manifest.json');

/**
 * Listing-class commands. Each row represents a single fetchable entity
 * (post / paper / job / ...). The id of that entity must round-trip into
 * the site's detail command.
 */
const LISTING_NAMES = new Set([
    'search', 'hot', 'recent', 'trending', 'top', 'feed', 'popular',
    'list', 'best', 'newest', 'latest', 'rising', 'controversial',
    'home', 'timeline', 'browse', 'discover', 'jobs',
    'unanswered', 'bounties', 'tag', 'user', 'venue',
    'category', 'subreddit', 'question',
]);

/**
 * Listing-class commands whose rows are sub-resources within a parent
 * thread/session, NOT independently fetchable. Excluded from the rule:
 *
 * - `comments` / `replies` / `reviews` / `answer-list` / `thread-list`
 *   — rows are comments under a parent post; the detail command fetches
 *   the parent, not the comment
 * - `ask` / `new` / `show` for AI-chat / agent-session sites — rows are
 *   conversation turns within one session, not separately addressable
 *
 * These are intentionally NOT in `LISTING_NAMES` so the rule doesn't
 * fire on them.
 */


const DETAIL_NAMES = new Set([
    'read', 'article', 'paper', 'post', 'detail', 'view', 'job',
    'page', 'book', 'movie', 'show-detail', 'chapter', 'tweet',
    'video', 'track', 'note', 'review', 'item', 'product', 'episode',
    'thread', 'comment-detail', 'profile-detail', 'shop',
]);

/** Columns whose name implies "this is an id you can pass to detail". */
const ID_COLUMN_PATTERNS = [
    /^id$/i,
    /_id$/i,
    /Id$/,
    /^short_id$/i,
    /^jk$/i,             // indeed
    /^tid$/i,            // hupu / thread id
    /^bvid$/i,           // bilibili
    /^aid$/i,            // anime / bilibili av
    /^asin$/i,           // amazon
    /^sku$/i,            // jd / retail product SKU
    /^isbn$/i,           // book sites
    /^doi$/i,            // arxiv / openreview
    /^slug$/i,           // dev.to / lobsters short slug
    /^hn_id$/i,
    /^username$/i,       // user-keyed detail (profile commands)
    /^handle$/i,
    /^uri$/i,            // bluesky AT URI (at://did:.../...)
];

function isUrlDetailCommand(entry) {
    const args = Array.isArray(entry.args) ? entry.args : [];
    const primaryArg = args.find((arg) => arg?.positional || arg?.required) ?? args[0];
    if (!primaryArg) return false;
    const name = String(primaryArg.name ?? '').toLowerCase();
    if (name === 'url' || name === 'url-or-id') return true;

    const help = String(primaryArg.help ?? '').toLowerCase();
    if (!help) return false;

    // Accept only explicit "this argument may be a URL" wording. Phrases
    // like "id from URL" mean callers must extract an id before invoking
    // the detail command, so listing.url must not satisfy the id-pair gate.
    return (
        /^full\b[^()]*\burl\b/.test(help) ||
        /\burl\s+or\s+[^()]*\bid\b/.test(help) ||
        /\bor\s+(?:a\s+)?full\b[^()]*\burl\b/.test(help) ||
        /\bor\s+url\b/.test(help) ||
        /\burl\s*,\s*or\b/.test(help)
    );
}

function isIdColumn(col, detailCommands) {
    if (ID_COLUMN_PATTERNS.some((re) => re.test(col))) return true;
    if (/^url$/i.test(col)) {
        return detailCommands.some(isUrlDetailCommand);
    }
    return false;
}

function classify(name) {
    if (LISTING_NAMES.has(name)) return 'listing';
    if (DETAIL_NAMES.has(name)) return 'detail';
    return 'other';
}

function main() {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

    const bySite = new Map();
    for (const entry of manifest) {
        if (!entry?.site || !entry?.name) continue;
        if (!bySite.has(entry.site)) bySite.set(entry.site, []);
        bySite.get(entry.site).push(entry);
    }

    const findings = [];
    let scannedSites = 0;
    let scannedListings = 0;

    for (const [site, entries] of bySite) {
        // Only `access: 'read'` detail commands count — write commands like
        // `instagram/post` or `instagram/note` create remote state, they don't
        // fetch by id, so the listing→detail pairing rule doesn't apply.
        const readDetail = entries.filter(
            (e) => classify(e.name) === 'detail' && e.access === 'read',
        );
        const hasListing = entries.some((e) => classify(e.name) === 'listing');
        if (!hasListing || readDetail.length === 0) continue;
        scannedSites++;

        for (const entry of entries) {
            if (classify(entry.name) !== 'listing') continue;
            scannedListings++;
            const columns = Array.isArray(entry.columns) ? entry.columns : [];
            if (!columns.some((col) => isIdColumn(col, readDetail))) {
                findings.push({
                    site,
                    name: entry.name,
                    columns,
                    detail: readDetail.map((e) => e.name),
                });
            }
        }
    }

    console.log(`Scanned ${scannedSites} site(s) with both listing and read-detail commands.`);
    console.log(`Checked ${scannedListings} listing command(s).`);

    if (findings.length === 0) {
        console.log('OK — every listing carries an id-shaped column.');
        return;
    }

    console.log('');
    console.log(`Advisory: ${findings.length} listing(s) without a round-trippable id column.`);
    console.log('Some of these are legitimate (topic strings, profile-attribute rows, UI-only');
    console.log('sessions); others may be worth adding an id to. Use judgment, not a gate.');
    console.log('');
    for (const v of findings) {
        console.log(`  • ${v.site}/${v.name}`);
        console.log(`      columns: [${v.columns.join(', ')}]`);
        console.log(`      detail commands on this site: ${v.detail.join(', ')}`);
    }
    console.log('');
    console.log('See docs/conventions/listing-detail-id-pairing.md for context and patterns.');
}

main();
