function decodeEntity(codePoint) {
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
        ? String.fromCodePoint(codePoint)
        : null;
}

export function stripHtml(html, { preserveBlocks = false } = {}) {
    if (!html) return '';
    let text = String(html);
    if (preserveBlocks) {
        text = text
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n\n');
    }
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (entity, value) => decodeEntity(Number(value)) ?? entity)
        .replace(/&#x([0-9a-f]+);/gi, (entity, value) => decodeEntity(Number.parseInt(value, 16)) ?? entity)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export const __test__ = { decodeEntity };
