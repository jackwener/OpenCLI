// musicbrainz release — fetch full MusicBrainz release detail by MBID.
//
// Hits `https://musicbrainz.org/ws/2/release/<mbid>?inc=artist-credits+labels+release-groups&fmt=json`.
// Returns the agent-useful projection: title, artist credit (joined), release
// group, primary type, status, packaging, release country/date, label /
// catalog number, language / script, barcode.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { MB_BASE, formatArtistCredit, mbFetch, requireMbid } from './utils.js';

function pickFirstReleaseEvent(events) {
    if (!Array.isArray(events) || events.length === 0) return { date: null, country: null };
    const first = events[0] || {};
    const area = first.area || {};
    const codes = Array.isArray(area['iso-3166-1-codes']) ? area['iso-3166-1-codes'] : [];
    return {
        date: String(first.date ?? '').trim() || null,
        country: codes[0] || String(area.name ?? '').trim() || null,
    };
}

function formatLabelInfo(labelInfo) {
    if (!Array.isArray(labelInfo) || labelInfo.length === 0) return { label: null, catalogNumber: null };
    const first = labelInfo[0] || {};
    return {
        label: String(first.label?.name ?? '').trim() || null,
        catalogNumber: String(first['catalog-number'] ?? '').trim() || null,
    };
}

cli({
    site: 'musicbrainz',
    name: 'release',
    access: 'read',
    description: 'Fetch full MusicBrainz release detail by MBID',
    domain: 'musicbrainz.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'mbid', positional: true, required: true, help: 'Release MBID (e.g. "76df3287-6cda-33eb-8e9a-044b5e15ffdd")' },
    ],
    columns: [
        'mbid', 'title', 'artistCredit', 'status', 'releaseGroup', 'primaryType',
        'firstReleaseDate', 'releaseCountry', 'releaseDate', 'label', 'catalogNumber',
        'barcode', 'packaging', 'language', 'script', 'url',
    ],
    func: async (args) => {
        const mbid = requireMbid(args.mbid, 'release');
        const url = `${MB_BASE}/release/${mbid}?inc=artist-credits+labels+release-groups&fmt=json`;
        const release = await mbFetch(url, 'musicbrainz release');
        const event = pickFirstReleaseEvent(release['release-events']);
        const labelInfo = formatLabelInfo(release['label-info']);
        const textRep = release['text-representation'] || {};
        const releaseGroup = release['release-group'] || {};
        return [{
            mbid,
            title: String(release.title ?? '').trim(),
            artistCredit: formatArtistCredit(release['artist-credit']),
            status: String(release.status ?? '').trim() || null,
            releaseGroup: String(releaseGroup.title ?? '').trim() || null,
            primaryType: String(releaseGroup['primary-type'] ?? '').trim() || null,
            firstReleaseDate: String(releaseGroup['first-release-date'] ?? '').trim() || null,
            releaseCountry: event.country,
            releaseDate: event.date,
            label: labelInfo.label,
            catalogNumber: labelInfo.catalogNumber,
            barcode: String(release.barcode ?? '').trim() || null,
            packaging: String(release.packaging ?? '').trim() || null,
            language: String(textRep.language ?? '').trim() || null,
            script: String(textRep.script ?? '').trim() || null,
            url: `https://musicbrainz.org/release/${mbid}`,
        }];
    },
});
