// archive item: Internet Archive item metadata (one row per identifier).
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

const IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/;

cli({
    site: 'archive',
    name: 'item',
    access: 'read',
    description: 'Fetch metadata for a single Internet Archive item by identifier.',
    domain: 'archive.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'identifier', positional: true, required: true, help: 'Archive item identifier (e.g. "open-syllabus", "FinalFantasy2_356").' },
    ],
    columns: ['identifier', 'title', 'creator', 'date', 'mediatype', 'collection', 'description', 'file_count', 'url'],
    func: async (args) => {
        const identifier = String(args.identifier ?? '').trim();
        if (!identifier) {
            throw new ArgumentError(
                'archive item identifier cannot be empty',
                'Example: opencli archive item open-syllabus',
            );
        }
        if (!IDENTIFIER_RE.test(identifier)) {
            throw new ArgumentError(
                `archive item identifier "${args.identifier}" is not valid`,
                'Archive item identifiers may only contain letters, digits, ".", "_", "-".',
            );
        }

        const url = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`archive item request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`archive item failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`archive item returned malformed JSON: ${error?.message || error}`);
        }

        const meta = data?.metadata;
        // The metadata endpoint returns {} for missing or dark items.
        if (!meta || typeof meta !== 'object' || !meta.identifier) {
            throw new EmptyResultError('archive item', `No public metadata for "${identifier}" on archive.org.`);
        }
        const responseIdentifier = String(meta.identifier);
        if (!IDENTIFIER_RE.test(responseIdentifier)) {
            throw new CommandExecutionError('archive item returned malformed payload: metadata.identifier is not stable');
        }
        if (responseIdentifier !== identifier) {
            throw new CommandExecutionError(`archive item returned metadata for "${responseIdentifier}" instead of "${identifier}"`);
        }

        const creator = Array.isArray(meta.creator) ? meta.creator.join(', ') : String(meta.creator ?? '');
        const collection = Array.isArray(meta.collection) ? meta.collection.join(', ') : String(meta.collection ?? '');
        const description = Array.isArray(meta.description) ? meta.description.join(' ') : String(meta.description ?? '');
        if (!Array.isArray(data.files)) {
            throw new CommandExecutionError('archive item returned malformed payload: files must be an array');
        }

        return [{
            identifier: responseIdentifier,
            title: String(meta.title ?? ''),
            creator,
            date: meta.date ? String(meta.date).slice(0, 10) : '',
            mediatype: String(meta.mediatype ?? ''),
            collection,
            description,
            file_count: data.files.length,
            url: `https://archive.org/details/${responseIdentifier}`,
        }];
    },
});
