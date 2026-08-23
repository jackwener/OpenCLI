import { stripHtml as stripHtmlText } from './text.js';

export function stripHtml(html) {
    return stripHtmlText(html, { preserveBlocks: true });
}

export function normalizeCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function normalizeUnixSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? new Date(value * 1000).toISOString()
        : '';
}
