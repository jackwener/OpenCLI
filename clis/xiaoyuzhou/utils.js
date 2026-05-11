/** Format seconds to mm:ss (e.g. 3890 → "64:50"). Returns '-' for invalid input. */
export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0)
        return '-';
    seconds = Math.round(seconds);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
/** Format ISO date string to YYYY-MM-DD. Returns '-' for missing input. */
export function formatDate(iso) {
    if (!iso)
        return '-';
    return iso.slice(0, 10);
}
