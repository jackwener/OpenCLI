export function toLocalTime(utcStr) {
    if (!utcStr)
        return '';
    const date = new Date(utcStr);
    return Number.isNaN(date.getTime()) ? utcStr : date.toLocaleString();
}

export function stripHtml(html) {
    return (html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(?:(\d+)|x([0-9a-fA-F]+));/g, (_, dec, hex) => {
        try {
            return String.fromCodePoint(dec !== undefined ? Number(dec) : parseInt(hex, 16));
        }
        catch {
            return '';
        }
    })
        .replace(/\s+/g, ' ')
        .trim();
}
