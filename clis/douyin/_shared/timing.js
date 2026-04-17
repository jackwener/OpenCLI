const MIN_OFFSET = 7200; // 2 hours
const MAX_OFFSET = 14 * 86400; // 14 days
export function validateTiming(unixSeconds) {
    if (!Number.isFinite(unixSeconds))
        throw new Error(`无效的时间戳: ${unixSeconds}`);
    const now = Math.floor(Date.now() / 1000);
    if (unixSeconds < now + MIN_OFFSET)
        throw new Error(`定时发布时间必须在至少 2 小时后`);
    if (unixSeconds > now + MAX_OFFSET)
        throw new Error(`定时发布时间不能超过 14 天`);
}
export function toUnixSeconds(input) {
    if (typeof input === 'number')
        return input;
    if (/^\d+$/.test(input)) {
        return Number(input);
    }
    const ms = new Date(input).getTime();
    if (isNaN(ms))
        throw new Error(`无效的时间格式: "${input}"`);
    return Math.floor(ms / 1000);
}
